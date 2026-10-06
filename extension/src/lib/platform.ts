import type { PlatformId, ProductPlatform, ShellHint } from "./types";

type NavigatorWithUAData = Navigator & {
  userAgentData?: { platform?: string };
};

/**
 * Best-effort platform detection for the machine that will run a copied
 * command. This is the browser's platform, which is the only signal available
 * without extra permissions.
 */
export function detectPlatform(nav: Navigator = navigator): ProductPlatform {
  const uaData = (nav as NavigatorWithUAData).userAgentData?.platform;
  const raw = [uaData, nav.platform, nav.userAgent]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");

  const id = classifyPlatform(raw);
  return { id, label: platformLabel(id), shell: shellFor(id), raw };
}

export function classifyPlatform(raw: string): PlatformId {
  const value = raw.toLowerCase();

  // Android before Linux, iOS before macOS: their UAs contain the desktop name.
  if (/\bandroid\b/.test(value)) return "android";
  if (/\b(iphone|ipad|ipod)\b/.test(value)) return "ios";
  // iPadOS 13+ reports as "Macintosh" but has touch points; UA alone cannot
  // distinguish it, so macOS is the honest answer here.
  if (/cros\b/.test(value)) return "chromeos";
  if (/\bwin(dows|32|64|dows nt)?\b/.test(value)) return "windows";
  if (/mac os x|macintosh|darwin/.test(value)) return "macos";
  if (/linux|x11|ubuntu|fedora|debian/.test(value)) return "linux";
  return "other";
}

export function platformLabel(id: PlatformId): string {
  switch (id) {
    case "windows":
      return "Windows";
    case "macos":
      return "macOS";
    case "linux":
      return "Linux";
    case "android":
      return "Android";
    case "ios":
      return "iOS";
    case "chromeos":
      return "ChromeOS";
    default:
      return "an unknown platform";
  }
}

export function shellFor(id: PlatformId): ShellHint {
  switch (id) {
    case "windows":
      return "powershell";
    case "macos":
    case "linux":
    case "chromeos":
      return "shell";
    case "android":
    case "ios":
      return "shell";
    default:
      return "unknown";
  }
}

/**
 * The phrasing handed to Laya for the `os_applicable` question, e.g.
 * "Linux (a POSIX shell such as bash or zsh)".
 */
export function platformQuestionContext(platform: ProductPlatform): string {
  switch (platform.shell) {
    case "powershell":
      return `${platform.label} (PowerShell / cmd)`;
    case "shell":
      return `${platform.label} (a POSIX shell such as bash or zsh)`;
    default:
      return platform.label;
  }
}
