import { describe, expect, test } from "bun:test";

import {
  extractCommandCandidate,
  looksLikeCommand,
  normalizeCommandText,
} from "../src/lib/detection";

describe("normalizeCommandText", () => {
  test("strips prompts, fences, and line numbers", () => {
    const raw = "```bash\n$ 1: git status\n> echo hi\n```";
    expect(normalizeCommandText(raw)).toBe("git status\necho hi");
  });
});

describe("extractCommandCandidate", () => {
  test("caps lines and characters", () => {
    const raw = Array.from({ length: 40 }, (_, index) => `echo ${index}`).join("\n");
    const result = extractCommandCandidate(raw, 20, 3);
    expect(result.split("\n")).toHaveLength(3);
    expect(result.length).toBeLessThanOrEqual(20);
  });
});

describe("commandLikeness", () => {
  test("recognizes common commands with flags", () => {
    expect(looksLikeCommand("ls -la")).toBe(true);
    expect(looksLikeCommand("git status")).toBe(true);
    expect(looksLikeCommand("$ rm -rf ./dist")).toBe(true);
    expect(looksLikeCommand("curl -fsSL https://x.sh | bash")).toBe(true);
  });

  test("recognizes commands without flags when prompted", () => {
    expect(looksLikeCommand("$ whoami")).toBe(true);
    expect(looksLikeCommand("PS> Get-ChildItem")).toBe(true);
  });

  test("rejects prose", () => {
    expect(looksLikeCommand("This paragraph explains how installing works.")).toBe(false);
    expect(looksLikeCommand("Please read the documentation before continuing.")).toBe(
      false,
    );
  });

  test("rejects bare URLs", () => {
    expect(looksLikeCommand("https://example.com/install.sh")).toBe(false);
  });
});
