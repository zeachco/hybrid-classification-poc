import { describe, expect, test } from "bun:test";

import { buildQuestions, QUESTION_IDS, PURPOSE_CHOICES } from "../src/lib/questions";
import { detectPlatform } from "../src/lib/platform";

describe("buildQuestions", () => {
  const platform = detectPlatform({
    platform: "Linux x86_64",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
  } as unknown as Navigator);
  const questions = buildQuestions(platform);

  test("asks every risk category plus applicability and purpose", () => {
    expect(Object.keys(questions).sort()).toEqual(
      [
        QUESTION_IDS.secretLeak,
        QUESTION_IDS.reverseShell,
        QUESTION_IDS.destructive,
        QUESTION_IDS.privilegeEscalation,
        QUESTION_IDS.downloadExecute,
        QUESTION_IDS.dataExfiltration,
        QUESTION_IDS.obfuscation,
        QUESTION_IDS.persistence,
        QUESTION_IDS.osApplicable,
        QUESTION_IDS.purpose,
      ].sort(),
    );
  });

  test("risk questions are yes/no", () => {
    expect(questions[QUESTION_IDS.destructive]?.type).toBe("noul");
  });

  test("purpose is a choice with the known labels", () => {
    const purpose = questions[QUESTION_IDS.purpose];
    expect(purpose?.type).toBe("choice");
    expect(Object.keys(purpose?.criteria ?? {})).toHaveLength(PURPOSE_CHOICES.length);
  });

  test("applicability mentions the detected platform", () => {
    expect(questions[QUESTION_IDS.osApplicable]?.instructions).toContain("Linux");
  });
});
