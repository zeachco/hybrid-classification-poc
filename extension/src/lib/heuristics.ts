import type {
  Finding,
  PlatformId,
  RiskCategory,
  RiskScores,
  Severity,
} from "./types";

type Rule = {
  id: string;
  category: RiskCategory;
  severity: Severity;
  detail: string;
  pattern: RegExp;
  /** Optional extra guard for patterns that are broad on their own. */
  when?: (command: string, match: RegExpMatchArray) => boolean;
};

export const SEVERITY_SCORE: Record<Severity, number> = {
  info: 0.1,
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1,
};

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// Command features that only make sense on a specific platform. Used to raise
// os_applicability risk when the browser is on a different platform.
const PLATFORM_COMMANDS: Array<{
  platform: PlatformId;
  label: string;
  pattern: RegExp;
}> = [
  {
    platform: "windows",
    label: "Windows-only tooling",
    pattern:
      /\b(powershell|pwsh|cmd(\.exe)?\s*\/c|Get-ChildItem|Get-Content|Invoke-WebRequest|Invoke-Expression|Set-ExecutionPolicy|New-ItemProperty|reg\s+add|reg\s+delete|wmic|tasklist|schtasks|diskpart|\.ps1\b|Format-Volume)/i,
  },
  {
    platform: "macos",
    label: "macOS-only tooling",
    pattern:
      /\b(brew\b|launchctl|defaults\s+write|pbcopy|pbpaste|open\s+-a\s|say\s+|diskutil|osascript|softwareupdate\b)/i,
  },
  {
    platform: "linux",
    label: "Linux-only tooling",
    pattern:
      /\b(apt(-get)?\s+(install|update|upgrade)|dnf\s+(install|update)|yum\s+install|pacman\s+-S|apk\s+add|systemctl|journalctl|snap\s+install|update-alternatives)\b/i,
  },
];

const RULES: Rule[] = [
  // --- destructive -------------------------------------------------------
  {
    id: "destructive-rm-root",
    category: "destructive",
    severity: "critical",
    detail: "Recursively deletes a root, home, or wildcard path.",
    pattern:
      /\brm\s+(-[a-z]*[rf][a-z]*\s+)*(\/|\/\*|~\/?|\$HOME|\.\/\*|\*)(\s|$)/i,
  },
  {
    id: "destructive-no-preserve-root",
    category: "destructive",
    severity: "critical",
    detail: "Explicitly disables coreutils' guard against deleting /.",
    pattern: /--no-preserve-root/i,
  },
  {
    id: "destructive-disk",
    category: "destructive",
    severity: "critical",
    detail: "Writes to or formats a raw disk device.",
    pattern:
      /\b(dd\s+.*\bof=\/dev\/|mkfs(\.[a-z0-9]+)?\s|mkswap\s|fdisk\s|parted\s|wipefs\s|shred\s|diskpart\b)/i,
  },
  {
    id: "destructive-fork-bomb",
    category: "destructive",
    severity: "critical",
    detail: "Classic shell fork bomb.",
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  },
  {
    id: "destructive-git",
    category: "destructive",
    severity: "medium",
    detail: "Discards uncommitted work in the current repository.",
    pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fdx][a-z]*|checkout\s+--\s+\.)/i,
  },
  {
    id: "destructive-redirect-device",
    category: "destructive",
    severity: "critical",
    detail: "Redirects output onto a raw device or partition.",
    pattern: /(^|[|;&]\s*)>+\s*\/dev\/(sd[a-z]|nvme|mmcblk|hd[a-z])/i,
  },

  // --- secret leak -------------------------------------------------------
  {
    id: "secret-env-dump",
    category: "secret_leak",
    severity: "high",
    detail: "Dumps environment variables, which often contain tokens.",
    pattern: /(^|[|;&]\s*)(sudo\s+)?(printenv|env)(\s*$|\s*[|;&>])/i,
  },
  {
    id: "secret-sensitive-file",
    category: "secret_leak",
    severity: "high",
    detail: "Reads a file that commonly stores credentials or keys.",
    pattern:
      /\b(cat|less|more|head|tail|grep|cp|scp|curl|tar)\b[^\n]*?(\.env\b|\.aws\/credentials|\.ssh\/id_[a-z]+|\.git-credentials|\.netrc|\.npmrc|\.pypirc|wp-config\.php|\bcredentials(\.json)?\b|secrets?\.(json|ya?ml|txt))/i,
  },
  {
    id: "secret-history",
    category: "secret_leak",
    severity: "medium",
    detail: "Reads shell history, which can contain past secrets.",
    pattern: /\b(cat|less|more|grep)\b[^\n]*(\.bash_history|\.zsh_history|history)\b|(^|[|;&]\s*)history\b/i,
  },
  {
    id: "secret-curl-auth",
    category: "secret_leak",
    severity: "high",
    detail: "Sends credentials (password, token, or Authorization header) over the network.",
    pattern:
      /\b(curl|wget|http)\b[^\n]*?(-u\s|--user\s|-p\s*[^ ]|Authorization:|--password|--token|api[_-]?key=)/i,
  },
  {
    id: "secret-ssh-key",
    category: "secret_leak",
    severity: "high",
    detail: "Moves or prints a private SSH key.",
    pattern: /\b(cat|cp|mv|scp|base64|openssl)\b[^\n]*(id_rsa|id_ed25519|id_ecdsa|\.pem\b|private[_-]?key)/i,
  },

  // --- reverse shell -----------------------------------------------------
  {
    id: "shell-dev-tcp",
    category: "reverse_shell",
    severity: "critical",
    detail: "Opens a raw TCP socket via bash's /dev/tcp pseudo-device.",
    pattern: /\/dev\/(tcp|udp)\//i,
  },
  {
    id: "shell-nc-exec",
    category: "reverse_shell",
    severity: "critical",
    detail: "Uses netcat's -e exec flag to hand over a shell.",
    pattern: /\b(nc|ncat|netcat)\b[^\n]*\s-e\s/i,
  },
  {
    id: "shell-bash-interactive",
    category: "reverse_shell",
    severity: "critical",
    detail: "Starts an interactive shell wired to a socket or pipe.",
    pattern: /\b(bash|sh|zsh)\b[^\n]*\s-i\b[^\n]*(>&|\/dev\/tcp|\|\s*(nc|ncat|socat))/i,
  },
  {
    id: "shell-socat-exec",
    category: "reverse_shell",
    severity: "critical",
    detail: "socat is bridging a shell to a network endpoint.",
    pattern: /\bsocat\b[^\n]*(exec|system):/i,
  },
  {
    id: "shell-mkfifo",
    category: "reverse_shell",
    severity: "high",
    detail: "builds a FIFO pipe commonly used to shovel a shell over netcat.",
    pattern: /\bmkfifo\b[^\n]*\|?\s*(nc|ncat|netcat|socat)/i,
  },
  {
    id: "shell-script-socket",
    category: "reverse_shell",
    severity: "critical",
    detail: "An inline script opens an outbound socket and spawns a shell.",
    pattern:
      /\b(python[0-9.]*|perl|ruby|php|node)\b[^\n]*(-c|-e|-r)\b[^\n]*(socket|fsockopen|TCPSocket|net\.Socket)[^\n]*(connect|Shell|exec|system)/i,
  },

  // --- download & execute ------------------------------------------------
  {
    id: "exec-download-pipe",
    category: "download_execute",
    severity: "critical",
    detail: "Downloads a script and pipes it straight into an interpreter.",
    pattern:
      /\b(curl|wget)\b[^\n|;&]*\|[^\n]*(bash|sh|zsh|ksh|python[0-9.]*|perl|ruby|node)\b/i,
  },
  {
    id: "exec-powershell-pipe",
    category: "download_execute",
    severity: "critical",
    detail: "Downloads and evaluates PowerShell in one line.",
    pattern: /\b(iwr|Invoke-WebRequest|Invoke-RestMethod|curl)\b[^\n|]*\|[^\n]*(iex|Invoke-Expression)/i,
  },
  {
    id: "exec-base64-command",
    category: "download_execute",
    severity: "high",
    detail: "Runs a PowerShell command decoded from base64.",
    pattern: /-(enc|encodedcommand)\s+[A-Za-z0-9+/=]{16,}/i,
  },
  {
    id: "exec-base64-pipe",
    category: "download_execute",
    severity: "high",
    detail: "Decodes base64 and pipes it into a shell or interpreter.",
    pattern:
      /\b(base64|b64decode|FromBase64String)\b[^\n]*(--decode|-d|-D)?[^\n]*\|[^\n]*(sh|bash|zsh|python[0-9.]*|perl|ruby|node|iex)/i,
  },

  // --- obfuscation -------------------------------------------------------
  {
    id: "obfuscation-eval",
    category: "obfuscation",
    severity: "medium",
    detail: "Evaluates code built at runtime, often to hide intent.",
    pattern: /\b(eval|exec|assert)\s*\(\s*(base64|atob|buffer|bytes|String\.fromCharCode|decode)/i,
  },
  {
    id: "obfuscation-escapes",
    category: "obfuscation",
    severity: "medium",
    detail: "Contains long runs of hex/unicode escapes.",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}|(\\u[0-9a-fA-F]{4}){6,}/,
  },
  {
    id: "obfuscation-base64-blob",
    category: "obfuscation",
    severity: "medium",
    detail: "Carries a large opaque base64 blob.",
    pattern: /[A-Za-z0-9+/]{120,}={0,2}/,
  },

  // --- privilege escalation ---------------------------------------------
  {
    id: "priv-sudo-shell",
    category: "privilege_escalation",
    severity: "high",
    detail: "Starts a root shell or runs arbitrary commands as root.",
    pattern: /\b(sudo|doas)\b\s+(-i|-s|su\b|bash\b|sh\b)/i,
  },
  {
    id: "priv-runas",
    category: "privilege_escalation",
    severity: "high",
    detail: "Elevates privileges with Windows runas.",
    pattern: /\brunas\b\s+\/user:/i,
  },
  {
    id: "priv-setuid",
    category: "privilege_escalation",
    severity: "high",
    detail: "Marks a binary setuid/setgid so it always runs with elevated rights.",
    pattern: /\bchmod\b[^\n]*\s(\+s|[ug]\+s|[24][0-7]{3})\b|\bsetcap\b|\bpkexec\b/i,
  },

  // --- data exfiltration -------------------------------------------------
  {
    id: "exfil-scp-remote",
    category: "data_exfiltration",
    severity: "high",
    detail: "Copies local files to a remote host.",
    pattern: /\b(scp|rsync|sftp)\b[^\n]*\s\S+@\S+:/i,
  },
  {
    id: "exfil-curl-upload",
    category: "data_exfiltration",
    severity: "high",
    detail: "Uploads a file or body to a remote endpoint.",
    pattern: /\bcurl\b[^\n]*(\s-F\s|\s--form\s|\s-T\s|\s--upload-file\s|\s-d\s*@)/i,
  },
  {
    id: "exfil-pipe-remote",
    category: "data_exfiltration",
    severity: "high",
    detail: "Pipes file contents to a remote command.",
    pattern: /\b(tar|cat|base64|gzip|zip)\b[^\n]*\|[^\n]*\b(ssh|nc|ncat|socat|curl|wget)\b/i,
  },

  // --- persistence -------------------------------------------------------
  {
    id: "persist-cron",
    category: "persistence",
    severity: "medium",
    detail: "Installs or edits a scheduled job.",
    pattern: /\bcrontab\b|(\/etc\/cron|\/var\/spool\/cron)/i,
  },
  {
    id: "persist-systemd",
    category: "persistence",
    severity: "medium",
    detail: "Enables a service so it survives reboot.",
    pattern: /\bsystemctl\b[^\n]*\benable\b|\blaunchctl\b[^\n]*\b(load|bootstrap)\b|\bupdate-rc\.d\b|\bchkconfig\b/i,
  },
  {
    id: "persist-schtasks",
    category: "persistence",
    severity: "medium",
    detail: "Creates a Windows scheduled task or Run-key entry.",
    pattern: /\b(schtasks|at)\b[^\n]*\/create|\breg\b[^\n]*(add|import)[^\n]*(Run|RunOnce)/i,
  },
  {
    id: "persist-shell-rc",
    category: "persistence",
    severity: "medium",
    detail: "Appends to a shell startup file so it runs on every login.",
    pattern: />>?\s*~?\/?\.(bashrc|bash_profile|zshrc|zprofile|profile|config\/autostart)/i,
  },
];

function severityScore(severity: Severity): number {
  return SEVERITY_SCORE[severity];
}

function maxSeverity(current: Severity | undefined, next: Severity): Severity {
  if (!current) return next;
  return SEVERITY_RANK[next] > SEVERITY_RANK[current] ? next : current;
}

/**
 * Deterministic, instant risk assessment. Runs before (and alongside) Laya so
 * the tooltip can render immediately, and so a model that misses an obvious
 * `rm -rf /` cannot clear it.
 */
export function evaluateHeuristics(
  command: string,
  platform: PlatformId,
): { scores: RiskScores; findings: Finding[] } {
  const findings: Finding[] = [];
  const byCategory: Partial<Record<RiskCategory, Severity>> = {};

  for (const rule of RULES) {
    const match = command.match(rule.pattern);
    if (!match) continue;
    if (rule.when && !rule.when(command, match)) continue;
    findings.push({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      detail: rule.detail,
      evidence: match[0].trim().slice(0, 120),
    });
    byCategory[rule.category] = maxSeverity(byCategory[rule.category], rule.severity);
  }

  // Platform mismatch: a command that is clearly for another OS.
  for (const entry of PLATFORM_COMMANDS) {
    if (entry.platform === platform) continue;
    if (!entry.pattern.test(command)) continue;
    findings.push({
      id: "platform-mismatch",
      category: "os_applicability",
      severity: "medium",
      detail: `${entry.label} detected while the browser is on ${platform}.`,
      evidence: entry.label,
    });
    byCategory.os_applicability = maxSeverity(byCategory.os_applicability, "medium");
    break;
  }
  if (
    (platform === "android" || platform === "ios") &&
    /\bsudo\b/i.test(command)
  ) {
    findings.push({
      id: "platform-mismatch",
      category: "os_applicability",
      severity: "medium",
      detail: "sudo is not available on a stock mobile shell.",
      evidence: "sudo",
    });
    byCategory.os_applicability = maxSeverity(byCategory.os_applicability, "medium");
  }

  const scores: RiskScores = {};
  for (const [category, severity] of Object.entries(byCategory)) {
    scores[category as RiskCategory] = severityScore(severity);
  }

  findings.sort(
    (left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity],
  );

  return { scores, findings };
}

export const HEURISTIC_RULESET_VERSION = "1";
