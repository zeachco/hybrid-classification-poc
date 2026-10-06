import { describe, expect, test } from "bun:test";

import { QUESTION_IDS } from "../src/lib/questions";
import { evaluateHeuristics, scoreCommand } from "../src/lib/scoring";
import type { LayaAnswer, LayaPrediction } from "../src/lib/types";

function noul(probability: number, confidence = 0.9): LayaAnswer {
  return { type: "noul", noul: probability, answer_confidence: confidence };
}

function prediction(answers: Record<string, LayaAnswer>): LayaPrediction {
  return { answers };
}

describe("scoreCommand heuristics only", () => {
  test("ls -la is safe", () => {
    const verdict = scoreCommand({
      command: "ls -la",
      platform: "linux",
      heuristicMs: 1,
    });
    expect(verdict.level).toBe("safe");
    expect(verdict.engine).toBe("heuristic");
    expect(verdict.settled).toBe(false);
  });

  test("rm -rf / is dangerous with or without the model", () => {
    const heuristic = evaluateHeuristics("rm -rf /", "linux");
    const verdict = scoreCommand({
      command: "rm -rf /",
      platform: "linux",
      heuristicMs: 1,
      heuristic,
      prediction: prediction({ [QUESTION_IDS.destructive]: noul(0) }),
    });
    expect(verdict.level).toBe("dangerous");
    expect(verdict.engine).toBe("model");
    expect(verdict.findings.map((finding) => finding.id)).toContain("destructive-rm-root");
  });
});

describe("scoreCommand with the model", () => {
  test("the model can raise a risk the rules missed", () => {
    const verdict = scoreCommand({
      command: "frobnicate --target remote",
      platform: "linux",
      heuristicMs: 1,
      prediction: prediction({
        [QUESTION_IDS.reverseShell]: noul(0.95),
        [QUESTION_IDS.purpose]: {
          type: "choice",
          choice: "Network operation",
          probabilities: { "Network operation": 0.8 },
        },
      }),
    });
    expect(verdict.level).toBe("dangerous");
    expect(verdict.categories.reverse_shell).toBeGreaterThan(0.9);
    expect(verdict.purpose).toBe("Network operation");
  });

  test("an OS mismatch alone is not_applicable, not dangerous", () => {
    const verdict = scoreCommand({
      command: 'powershell -Command "Get-ChildItem"',
      platform: "linux",
      heuristicMs: 1,
    });
    expect(verdict.level).toBe("not_applicable");
    expect(verdict.findings.some((finding) => finding.id === "platform-mismatch")).toBe(true);
  });

  test("a low applicability answer from the model raises the mismatch", () => {
    const verdict = scoreCommand({
      command: "brew install ripgrep",
      platform: "linux",
      heuristicMs: 1,
      prediction: prediction({ [QUESTION_IDS.osApplicable]: noul(0.1) }),
    });
    expect(verdict.categories.os_applicability).toBeGreaterThan(0.8);
  });

  test("a missing answer is treated as no risk", () => {
    const verdict = scoreCommand({
      command: "echo hello",
      platform: "linux",
      heuristicMs: 1,
      prediction: prediction({}),
    });
    expect(verdict.level).toBe("safe");
    expect(verdict.settled).toBe(true);
  });
});
