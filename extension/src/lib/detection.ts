import { MAX_COMMAND_CHARS, MAX_COMMAND_LINES } from "./types";

const KNOWN_COMMANDS = new Set(
  [
    "git", "npm", "npx", "pnpm", "yarn", "bun", "deno", "node", "python",
    "python3", "pip", "pip3", "poetry", "uv", "ruby", "gem", "go", "cargo",
    "rustc", "make", "cmake", "gcc", "g++", "clang", "java", "javac", "mvn",
    "gradle", "dotnet", "php", "composer", "curl", "wget", "http", "httpie",
    "bash", "sh", "zsh", "fish", "pwsh", "powershell", "cmd", "sudo", "doas",
    "su", "apt", "apt-get", "dnf", "yum", "pacman", "brew", "snap", "docker",
    "docker-compose", "podman", "kubectl", "helm", "terraform", "ansible",
    "ssh", "scp", "sftp", "rsync", "ssh-keygen", "gpg", "openssl", "vault",
    "aws", "gcloud", "az", "heroku", "fly", "railway", "vercel", "netlify",
    "tar", "gzip", "zip", "unzip", "rm", "mv", "cp", "mkdir", "rmdir",
    "touch", "cat", "less", "more", "head", "tail", "sed", "awk", "grep",
    "find", "xargs", "chmod", "chown", "ln", "stat", "du", "df", "mount",
    "ls", "pwd", "cd", "echo", "printf", "which", "whoami", "id", "uname",
    "ps", "kill", "pkill", "top", "htop", "watch", "date", "sleep", "seq",
    "tee", "wc", "sort", "uniq", "cut", "tr", "diff", "patch", "jq", "yq",
    "ping", "dig", "nslookup", "traceroute", "gh", "glab", "vim", "nano",
    "tmux", "screen", "ssh-add", "ssh-copy-id", "pass", "systemd-run",
    "systemctl", "journalctl", "service", "crontab", "launchctl", "schtasks",
    "reg", "wmic", "certutil", "netsh", "taskkill", "tasklist", "sc",
    "nmap", "nc", "ncat", "netcat", "socat", "tcpdump", "iptables", "ufw",
    "mysql", "psql", "sqlite3", "redis-cli", "mongosh", "ffmpeg", "convert",
    "base64", "md5sum", "sha256sum", "dd", "mkfs", "fdisk", "parted", "shred",
    "eval", "exec", "source", "export", "printenv", "env", "history", "alias",
    "Get-ChildItem", "Get-Content", "Invoke-WebRequest", "Invoke-Expression",
    "Set-ExecutionPolicy", "Start-Process", "Stop-Process",
  ],
);

const PROMPT_PATTERN = /^(?:\$|PS[^>]*>|>|#|%|\u276f|\u279c)\s+/;
const SHELL_OPERATORS = /(\|\||&&|\||;|>>?|<<?|`|\$\()/;
const FLAG_PATTERN = /(^|\s)--?[A-Za-z][\w-]*/;
const COMMAND_FENCE = /^```[a-zA-Z0-9_+-]*\s*\n?/;
const LINE_NUMBER = /^\s*\d+[:.)]\s+/;
const URL_ONLY = /^(https?:\/\/|mailto:)\S+$/i;
const WORDLIKE_RUN = /[A-Za-z]{2,}/g;

/** Remove prompts, fences, and line numbers from a candidate command block. */
export function normalizeCommandText(raw: string): string {
  let text = raw.replace(/\r\n?/g, "\n").trim();
  text = text.replace(COMMAND_FENCE, "").replace(/\n?```\s*$/, "");
  const lines = text
    .split("\n")
    .map((line) => line.replace(PROMPT_PATTERN, "").replace(LINE_NUMBER, "").trim())
    .filter((line, index, all) => line.length > 0 || (index > 0 && index < all.length - 1));
  return lines.join("\n").trim();
}

/** Truncate a candidate to the model's interactive budget. */
export function extractCommandCandidate(
  raw: string,
  maxChars = MAX_COMMAND_CHARS,
  maxLines = MAX_COMMAND_LINES,
): string {
  const normalized = normalizeCommandText(raw);
  const lines = normalized.split("\n").slice(0, maxLines).join("\n");
  return lines.slice(0, maxChars).trim();
}

/**
 * Heuristic "does this text look like a shell command?" score in 0..1.
 * Pure text — no DOM — so it can be unit tested.
 */
export function commandLikeness(text: string): number {
  const candidate = normalizeCommandText(text);
  if (!candidate) return 0;
  if (URL_ONLY.test(candidate)) return 0.1;

  const firstLine = candidate.split("\n")[0]!.trim();
  if (!firstLine) return 0;
  const firstToken = firstLine.split(/\s+/)[0]!.replace(/^["']|["']$/g, "");
  const baseCommand = firstToken.split("/").pop() ?? firstToken;

  let score = 0;
  if (PROMPT_PATTERN.test(text.trim())) score += 0.35;
  if (KNOWN_COMMANDS.has(baseCommand)) score += 0.5;
  if (KNOWN_COMMANDS.has(baseCommand.toLowerCase())) score += 0.05;
  if (SHELL_OPERATORS.test(candidate)) score += 0.2;
  if (FLAG_PATTERN.test(candidate)) score += 0.15;
  if (/\/dev\/tcp|\/bin\/(ba)?sh|\/usr\/bin\/env/.test(candidate)) score += 0.2;
  if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+/i.test(firstLine)) score += 0.1; // ./bin/tool

  // A known command followed by four or more plain words and no flags or
  // operators is more likely prose ("go to the store") than a real command.
  const tokenCount = firstLine.split(/\s+/).length;
  if (
    KNOWN_COMMANDS.has(baseCommand) &&
    tokenCount >= 4 &&
    !FLAG_PATTERN.test(candidate) &&
    !SHELL_OPERATORS.test(candidate)
  ) {
    score -= 0.15;
  }

  // Prose penalties.
  const words = candidate.match(WORDLIKE_RUN)?.length ?? 0;
  const sentences = (candidate.match(/[.!?](\s|$)/g) ?? []).length;
  if (words > 12 && !SHELL_OPERATORS.test(candidate)) score -= 0.35;
  if (sentences >= 2) score -= 0.25;
  if (candidate.split("\n").length > 3 && !SHELL_OPERATORS.test(candidate)) score -= 0.1;
  if (/^(the|this|a|an|it|we|you|to|if|when|how|why|what)\b/i.test(firstLine)) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

export function looksLikeCommand(text: string, threshold = 0.5): boolean {
  return commandLikeness(text) >= threshold;
}

// ---------------------------------------------------------------------------
// DOM helpers (content script only)
// ---------------------------------------------------------------------------

const COMMAND_TAGS = new Set(["CODE", "PRE", "KBD", "SAMP"]);
const COMMAND_CLASS = /\b(lang(uage)?-[a-z0-9+#-]*|highlight|terminal|shell|console|cmd|bash|zsh|powershell)\b/i;

export function isElementVisible(element: Element): boolean {
  const html = element as HTMLElement;
  if (html.hidden) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function textOf(element: Element): string {
  return (element.textContent ?? "").trim();
}

/**
 * Walk up from the event target looking for a code-like element that holds a
 * plausible command. Returns null when nothing convincing is found.
 */
export function findCommandElement(
  target: EventTarget | null,
  threshold = 0.5,
): { element: Element; text: string } | null {
  if (!(target instanceof Element)) return null;
  // Ignore our own tooltip host and anything inside it.
  if (target.closest("[data-laya-guard]")) return null;
  let element: Element | null = target;

  for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
    const tagLike = COMMAND_TAGS.has(element.tagName) || COMMAND_CLASS.test(element.className);
    const text = textOf(element);
    if (!text || text.length > MAX_COMMAND_CHARS * 4) continue;
    if (!isElementVisible(element)) continue;

    if (tagLike && looksLikeCommand(text, 0.3)) {
      return { element, text };
    }
    if (looksLikeCommand(text, threshold) && element.childElementCount <= 8) {
      return { element, text };
    }
  }
  return null;
}

/** Extract a command from the current selection, if any. */
export function commandFromSelection(selection: Selection | null): string | null {
  if (!selection || selection.isCollapsed) return null;
  const text = selection.toString().trim();
  if (!text || !looksLikeCommand(text)) return null;
  return extractCommandCandidate(text);
}
