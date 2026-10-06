// Shared types for every extension context (background, offscreen, content,
// popup) and for the two pure-logic layers (heuristics and the Laya scorer).

export type QuestionType = "choice" | "score" | "noul";

/** A question as understood by the Laya runtime. */
export type LayaQuestion = {
  type: QuestionType;
  instructions: string;
  criteria?: Record<string, string | null> | string[];
  threshold?: number;
};

export type LayaAnswer = {
  type: QuestionType;
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
  answer_confidence?: number;
  probabilities?: Record<string, number>;
};

export type LayaPrediction = {
  answers: Record<string, LayaAnswer>;
};

export type PlatformId =
  | "windows"
  | "macos"
  | "linux"
  | "android"
  | "ios"
  | "chromeos"
  | "other";

export type ShellHint = "powershell" | "cmd" | "shell" | "unknown";

export type ProductPlatform = {
  id: PlatformId;
  label: string;
  shell: ShellHint;
  /** Raw string the platform was derived from, for logging/debugging. */
  raw: string;
};

export type RiskCategory =
  | "secret_leak"
  | "reverse_shell"
  | "destructive"
  | "privilege_escalation"
  | "download_execute"
  | "data_exfiltration"
  | "obfuscation"
  | "persistence"
  | "os_applicability";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Finding = {
  id: string;
  category: RiskCategory;
  severity: Severity;
  detail: string;
  evidence?: string;
};

/** Per-category risk in the 0–1 range; absent means "no signal". */
export type RiskScores = Partial<Record<RiskCategory, number>>;

export type VerdictLevel = "safe" | "caution" | "dangerous" | "not_applicable";

export type VerdictEngine = "heuristic" | "model";

export type Verdict = {
  level: VerdictLevel;
  score: number;
  confidence: number;
  platform: PlatformId;
  purpose: string;
  categories: RiskScores;
  findings: Finding[];
  engine: VerdictEngine;
  /** True when Laya has answered; false while only heuristics have run. */
  settled: boolean;
  timings: { heuristicMs: number; modelMs?: number };
  model?: LayaPrediction;
};

export type AttemptSource = "hover" | "selection" | "copy" | "manual";

/** A single logged evaluation, rendered by the popup. */
export type AttemptLogEntry = {
  id: number;
  at: string;
  source: AttemptSource;
  url: string;
  platform: PlatformId;
  commandLength: number;
  /** Redacted preview unless the user enabled verbose logging. */
  commandPreview: string;
  commandHash: string;
  level: VerdictLevel;
  score: number;
  engine: VerdictEngine;
  findingIds: string[];
  heuristicMs: number;
  modelMs?: number;
};

export type ModelState = "cold" | "loading" | "ready" | "error";

export const MAX_COMMAND_CHARS = 2048;
export const MAX_COMMAND_LINES = 20;

// ---------------------------------------------------------------------------
// Messaging (content ⇄ background, background ⇄ offscreen)
// ---------------------------------------------------------------------------

export type EvaluateRequest = {
  type: "evaluate";
  command: string;
  source: AttemptSource;
  url: string;
  platform: PlatformId;
};

export type EvaluateResponse =
  | { ok: true; verdict: Verdict; modelPending: boolean }
  | { ok: false; error: string };

export type StatusResponse = {
  ok: true;
  modelState: ModelState;
  attempts: AttemptLogEntry[];
  enabled: boolean;
  lastError: string | null;
};

export type ContentToBackground =
  | EvaluateRequest
  | { type: "status" }
  | { type: "warm" }
  | { type: "log"; entry: AttemptLogEntry };

export type OffscreenRequest =
  | { type: "load" }
  | { type: "predict"; requestId: number; state: string; questions: Record<string, LayaQuestion> };

export type OffscreenResponse =
  | { type: "loaded" }
  | { type: "progress"; phase: string }
  | { type: "prediction"; requestId: number; prediction: LayaPrediction }
  | { type: "error"; requestId?: number; message: string };
