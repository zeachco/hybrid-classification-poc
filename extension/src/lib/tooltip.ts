import type { RiskCategory, Verdict, VerdictLevel } from "./types";

const CATEGORY_LABELS: Record<RiskCategory, string> = {
  secret_leak: "Secret leak",
  reverse_shell: "Reverse shell",
  destructive: "Destructive",
  privilege_escalation: "Privilege escalation",
  download_execute: "Download & execute",
  data_exfiltration: "Data exfiltration",
  obfuscation: "Obfuscation",
  persistence: "Persistence",
  os_applicability: "OS mismatch",
};

const LEVEL_LABEL: Record<VerdictLevel, string> = {
  safe: "Looks safe",
  caution: "Caution",
  dangerous: "Dangerous",
  not_applicable: "Not for this OS",
};

const LEVEL_COLOR: Record<VerdictLevel, string> = {
  safe: "#2f9e44",
  caution: "#e8a300",
  dangerous: "#e03131",
  not_applicable: "#5c7cfa",
};

const STYLE = `
  :host { all: initial; }
  .card {
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #f5f5f5;
    background: #16181d;
    border: 1px solid #2c2f36;
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    padding: 10px 12px;
    width: 300px;
    pointer-events: auto;
  }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .title { font-weight: 600; letter-spacing: 0.02em; color: #cfd3dc; }
  .engine {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    color: #9aa0aa; border: 1px solid #3a3e46; border-radius: 999px; padding: 1px 6px;
  }
  .verdict { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
  .chip {
    font-weight: 700; padding: 2px 8px; border-radius: 999px; color: #10120f;
    background: var(--level-color, #888);
  }
  .score { color: #b9bec7; }
  .meta { margin-top: 6px; color: #9aa0aa; }
  .pending { margin-top: 6px; color: #e8a300; }
  .bars { margin-top: 8px; display: grid; gap: 4px; }
  .bar { display: grid; grid-template-columns: 118px 1fr 34px; align-items: center; gap: 6px; }
  .bar-label { color: #c7ccd4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .track { height: 6px; border-radius: 999px; background: #2a2d34; overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; background: var(--level-color, #5c7cfa); }
  .bar-value { text-align: right; color: #9aa0aa; }
  .findings { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 3px; }
  .findings li { color: #d6dae1; }
  .findings li::before { content: "› "; color: var(--level-color, #888); }
  .evidence { color: #838a95; }
  .error { color: #ff8787; }
  .busy-message { margin-top: 6px; color: #f0b429; }
  .busy-row { margin-top: 8px; }
  .busy-target {
    color: #c7ccd4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .foot { margin-top: 8px; color: #6b7280; font-size: 10px; }
`;

export type TooltipAnchor = { rect: DOMRect };

export type BusyOptions = {
  message: string;
  /** The command currently being classified. */
  inFlight?: { label: string };
  /** The hovered command's instant heuristic verdict, shown while waiting. */
  verdict?: Verdict;
};

function previewCommand(command: string, max = 44): string {
  const firstLine = command.split("\n")[0]?.trim() ?? command.trim();
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine;
}

/**
 * Floating tooltip rendered in a closed shadow root so page CSS cannot affect
 * it and the page can never read the rendered command text back.
 */
export class CommandTooltip {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private card: HTMLDivElement;
  private onDocumentScroll = () => this.hide();

  constructor(doc: Document = document) {
    this.host = doc.createElement("div");
    this.host.setAttribute("data-laya-guard", "tooltip");
    this.host.style.cssText =
      "position:fixed;z-index:2147483647;top:0;left:0;pointer-events:none;";
    this.shadow = this.host.attachShadow({ mode: "closed" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    this.card = doc.createElement("div");
    this.card.className = "card";
    this.shadow.append(style, this.card);
    doc.documentElement.append(this.host);

    window.addEventListener("scroll", this.onDocumentScroll, true);
    window.addEventListener("resize", this.onDocumentScroll);
  }

  destroy(): void {
    window.removeEventListener("scroll", this.onDocumentScroll, true);
    window.removeEventListener("resize", this.onDocumentScroll);
    this.host.remove();
  }

  hide(): void {
    this.host.style.display = "none";
  }

  private place(rect: DOMRect): void {
    const margin = 8;
    const width = 300;
    const height = this.card.getBoundingClientRect().height || 180;
    let left = rect.left;
    let top = rect.bottom + margin;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - height - margin);
    }
    this.host.style.left = `${Math.max(margin, left)}px`;
    this.host.style.top = `${Math.max(margin, top)}px`;
  }

  private setCard(level: VerdictLevel | null): void {
    this.card.style.setProperty(
      "--level-color",
      level ? LEVEL_COLOR[level] : "#5c7cfa",
    );
  }

  private header(badge: string): DocumentFragment {
    const head = document.createElement("div");
    head.className = "head";
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = "Laya Command Guard";
    const engine = document.createElement("span");
    engine.className = "engine";
    engine.textContent = badge;
    head.append(title, engine);
    const fragment = document.createDocumentFragment();
    fragment.append(head);
    return fragment;
  }

  showPending(anchor: TooltipAnchor): void {
    this.setCard(null);
    this.card.replaceChildren(this.header("heuristic"));
    const pending = document.createElement("div");
    pending.className = "pending";
    pending.textContent = "Checking with the local model…";
    this.card.append(pending);
    const foot = document.createElement("div");
    foot.className = "foot";
    foot.textContent = "Runs in your browser · no data leaves this machine";
    this.card.append(foot);
    this.host.style.display = "block";
    this.place(anchor.rect);
  }

  showError(message: string, anchor?: TooltipAnchor): void {
    this.setCard("caution");
    this.card.replaceChildren(this.header("error"));
    const error = document.createElement("div");
    error.className = "error";
    error.textContent = message;
    this.card.append(error);
    this.host.style.display = "block";
    if (anchor) this.place(anchor.rect);
  }

  /**
   * Shown when a new command is hovered while Laya is already classifying
   * another one: the hovered command's instant heuristic verdict plus an arrow
   * pointing at the element currently being processed.
   */
  showBusy(anchor: TooltipAnchor, options: BusyOptions): void {
    this.setCard(options.verdict?.level ?? "caution");
    const fragment = this.header("busy");

    const message = document.createElement("div");
    message.className = "busy-message";
    message.textContent = options.message;
    fragment.append(message);

    if (options.verdict) {
      const row = document.createElement("div");
      row.className = "verdict";
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = LEVEL_LABEL[options.verdict.level];
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = `heuristic risk ${options.verdict.score}/100`;
      row.append(chip, score);
      fragment.append(row);
    }

    if (options.inFlight) {
      const row = document.createElement("div");
      row.className = "busy-row";
      const label = document.createElement("span");
      label.className = "busy-target";
      label.textContent = `checking: ${previewCommand(options.inFlight.label)}`;
      row.append(label);
      fragment.append(row);
    }

    const foot = document.createElement("div");
    foot.className = "foot";
    foot.textContent = "Laya classifies one command at a time · results are cached";
    fragment.append(foot);

    this.card.replaceChildren(fragment);
    this.host.style.display = "block";
    this.place(anchor.rect);
  }

  show(verdict: Verdict, anchor: TooltipAnchor, pending: boolean): void {
    this.setCard(verdict.level);
    const fragment = this.header(pending ? "heuristic" : "model");

    const verdictRow = document.createElement("div");
    verdictRow.className = "verdict";
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = LEVEL_LABEL[verdict.level];
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = `risk ${verdict.score}/100 · ${Math.round(verdict.confidence * 100)}% conf`;
    verdictRow.append(chip, score);
    fragment.append(verdictRow);

    if (verdict.purpose && verdict.purpose !== "Unrecognized") {
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `Purpose: ${verdict.purpose}`;
      fragment.append(meta);
    }
    const platform = document.createElement("div");
    platform.className = "meta";
    platform.textContent = `Platform: ${verdict.platform}`;
    fragment.append(platform);

    const entries = Object.entries(verdict.categories)
      .filter(([, value]) => (value ?? 0) > 0.05)
      .sort((left, right) => (right[1] as number) - (left[1] as number))
      .slice(0, 5);

    if (entries.length > 0) {
      const bars = document.createElement("div");
      bars.className = "bars";
      for (const [category, value] of entries) {
        const probability = (value as number) ?? 0;
        const row = document.createElement("div");
        row.className = "bar";
        const label = document.createElement("span");
        label.className = "bar-label";
        label.textContent = CATEGORY_LABELS[category as RiskCategory] ?? category;
        const track = document.createElement("div");
        track.className = "track";
        const fill = document.createElement("div");
        fill.className = "fill";
        fill.style.width = `${Math.round(probability * 100)}%`;
        track.append(fill);
        const number = document.createElement("span");
        number.className = "bar-value";
        number.textContent = `${Math.round(probability * 100)}%`;
        row.append(label, track, number);
        bars.append(row);
      }
      fragment.append(bars);
    }

    if (verdict.findings.length > 0) {
      const list = document.createElement("ul");
      list.className = "findings";
      for (const finding of verdict.findings.slice(0, 4)) {
        const item = document.createElement("li");
        item.textContent = finding.detail;
        if (finding.evidence) {
          const evidence = document.createElement("span");
          evidence.className = "evidence";
          evidence.textContent = ` (${finding.evidence})`;
          item.append(evidence);
        }
        list.append(item);
      }
      fragment.append(list);
    }

    if (pending) {
      const refining = document.createElement("div");
      refining.className = "pending";
      refining.textContent = "Refining with Laya…";
      fragment.append(refining);
    }

    const foot = document.createElement("div");
    foot.className = "foot";
    foot.textContent = "Advisory only · verify before running";
    fragment.append(foot);

    this.card.replaceChildren(fragment);
    this.host.style.display = "block";
    this.place(anchor.rect);
  }
}
