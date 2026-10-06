import { PURPOSE_CHOICES, QUESTION_IDS } from "./questions";
import { evaluateHeuristics, SEVERITY_RANK } from "./heuristics";
import type {
  Finding,
  LayaAnswer,
  LayaPrediction,
  PlatformId,
  RiskCategory,
  RiskScores,
  Verdict,
  VerdictLevel,
} from "./types";

/** Relative contribution of each category to the aggregate danger score. */
export const CATEGORY_WEIGHTS: Record<RiskCategory, number> = {
  secret_leak: 0.9,
  reverse_shell: 1,
  destructive: 1,
  privilege_escalation: 0.6,
  download_execute: 0.9,
  data_exfiltration: 0.8,
  obfuscation: 0.5,
  persistence: 0.6,
  os_applicability: 0.15,
};

const RISK_CATEGORIES: RiskCategory[] = [
  "secret_leak",
  "reverse_shell",
  "destructive",
  "privilege_escalation",
  "download_execute",
  "data_exfiltration",
  "obfuscation",
  "persistence",
];

const MODEL_CATEGORY_QUESTION: Record<RiskCategory, string | undefined> = {
  secret_leak: QUESTION_IDS.secretLeak,
  reverse_shell: QUESTION_IDS.reverseShell,
  destructive: QUESTION_IDS.destructive,
  privilege_escalation: QUESTION_IDS.privilegeEscalation,
  download_execute: QUESTION_IDS.downloadExecute,
  data_exfiltration: QUESTION_IDS.dataExfiltration,
  obfuscation: QUESTION_IDS.obfuscation,
  persistence: QUESTION_IDS.persistence,
  os_applicability: QUESTION_IDS.osApplicable,
};

/** Probability that a `noul` answer is "yes". */
export function yesProbability(answer: LayaAnswer | undefined): number {
  if (!answer) return 0;
  const value = answer.noul ?? answer.probabilities?.true ?? answer.score ?? 0;
  return clamp01(Number(value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function topChoice(answer: LayaAnswer | undefined): { label: string; probability: number } {
  if (!answer) return { label: "", probability: 0 };
  const probabilities = answer.probabilities ?? {};
  let best = answer.choice ?? "";
  let bestProbability = -1;
  for (const [label, probability] of Object.entries(probabilities)) {
    if (probability > bestProbability) {
      bestProbability = probability;
      best = label;
    }
  }
  if (bestProbability < 0) bestProbability = 0;
  // Prefer an explicit choice when the runtime returns one.
  if (answer.choice && probabilities[answer.choice] === undefined) {
    best = answer.choice;
  }
  return { label: best, probability: clamp01(bestProbability) };
}

function aggregateDanger(scores: RiskScores): number {
  let safe = 1;
  for (const category of RISK_CATEGORIES) {
    const score = scores[category] ?? 0;
    safe *= 1 - CATEGORY_WEIGHTS[category] * score;
  }
  return Math.round(100 * (1 - safe));
}

function levelFor(score: number, findings: Finding[]): VerdictLevel {
  if (findings.some((finding) => finding.severity === "critical")) return "dangerous";
  if (score < 20) return "safe";
  if (score < 55) return "caution";
  return "dangerous";
}

function addFinding(findings: Finding[], finding: Finding): void {
  if (!findings.some((existing) => existing.id === finding.id)) {
    findings.push(finding);
  }
}

function mergeScores(base: RiskScores, extra: RiskScores): RiskScores {
  const merged: RiskScores = { ...base };
  for (const [category, score] of Object.entries(extra) as Array<[RiskCategory, number]>) {
    merged[category] = Math.max(merged[category] ?? 0, score);
  }
  return merged;
}

export type ScoreInput = {
  command: string;
  platform: PlatformId;
  heuristicMs: number;
  modelMs?: number;
  heuristic?: { scores: RiskScores; findings: Finding[] };
  prediction?: LayaPrediction;
  modelConfidence?: number;
};

/**
 * Combine the deterministic heuristics with the Laya answers into the single
 * verdict the tooltip renders. Heuristics always run; the model can raise a
 * risk but can never clear a rule that already fired.
 */
export function scoreCommand(input: ScoreInput): Verdict {
  const heuristic =
    input.heuristic ?? evaluateHeuristics(input.command, input.platform);
  const findings: Finding[] = [...heuristic.findings];
  let scores: RiskScores = { ...heuristic.scores };
  let purpose = "Unrecognized";
  let modelConfidence = 0;
  let settled = false;

  if (input.prediction) {
    settled = true;
    const answers = input.prediction.answers ?? {};
    const modelScores: RiskScores = {};

    for (const category of RISK_CATEGORIES) {
      const questionId = MODEL_CATEGORY_QUESTION[category];
      if (!questionId) continue;
      const probability = yesProbability(answers[questionId]);
      if (probability > 0) {
        modelScores[category] = probability;
        if (probability >= 0.5 && !scores[category]) {
          addFinding(findings, {
            id: `model-${category}`,
            category,
            severity: probability >= 0.8 ? "high" : "medium",
            detail: `Laya rates this a ${category.replace(/_/g, " ")} risk.`,
          });
        }
      }
    }

    // OS applicability is inverted: a low "yes" means high mismatch risk.
    // A missing answer (the model returned nothing) is not evidence of a
    // mismatch, so only act when the answer is actually present.
    const applicabilityAnswer = answers[QUESTION_IDS.osApplicable];
    if (applicabilityAnswer) {
      const applicableProbability = yesProbability(applicabilityAnswer);
      if (applicableProbability < 0.5) {
        modelScores.os_applicability = 1 - applicableProbability;
        addFinding(findings, {
          id: "platform-mismatch",
          category: "os_applicability",
          severity: "low",
          detail: "Laya does not think this command is valid on the current platform.",
        });
      }
    }

    scores = mergeScores(scores, modelScores);
    const choice = topChoice(answers[QUESTION_IDS.purpose]);
    if (choice.label) {
      purpose = normalizePurpose(choice.label);
    }
    modelConfidence = Number(
      answers[QUESTION_IDS.destructive]?.answer_confidence ??
        answers[QUESTION_IDS.purpose]?.confidence ??
        choice.probability,
    );
  }

  findings.sort(
    (left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity],
  );

  const danger = aggregateDanger(scores);
  let level = levelFor(danger, findings);

  // A pure platform mismatch is not "dangerous" — it just won't run here.
  const osApplicability = scores.os_applicability ?? 0;
  if (
    level !== "dangerous" &&
    osApplicability >= 0.5 &&
    danger < 40
  ) {
    level = "not_applicable";
  }

  const confidence = settled
    ? clamp01(Math.max(0.6, modelConfidence))
    : clamp01(0.35 + 0.08 * findings.length);

  return {
    level,
    score: danger,
    confidence,
    platform: input.platform,
    purpose,
    categories: scores,
    findings,
    engine: settled ? "model" : "heuristic",
    settled,
    timings: { heuristicMs: input.heuristicMs, modelMs: input.modelMs },
    ...(input.prediction ? { model: input.prediction } : {}),
  };
}

function normalizePurpose(label: string): string {
  const match = PURPOSE_CHOICES.find(
    (choice) => choice.toLowerCase() === label.trim().toLowerCase(),
  );
  return match ?? label;
}

export { evaluateHeuristics };
