import { platformQuestionContext } from "./platform";
import type { LayaQuestion, ProductPlatform } from "./types";

/** Stable question ids; also used to read answers back in `scoring.ts`. */
export const QUESTION_IDS = {
  secretLeak: "risk_secret_leak",
  reverseShell: "risk_reverse_shell",
  destructive: "risk_destructive",
  privilegeEscalation: "risk_privilege_escalation",
  downloadExecute: "risk_download_execute",
  dataExfiltration: "risk_data_exfiltration",
  obfuscation: "risk_obfuscation",
  persistence: "risk_persistence",
  osApplicable: "os_applicable",
  purpose: "purpose",
} as const;

export const PURPOSE_CHOICES = [
  "A normal utility command",
  "File or directory management",
  "Network operation",
  "System administration",
  "Security-sensitive or destructive",
  "Unrecognizable",
] as const;

function yesNo(instruction: string, threshold = 0.5): LayaQuestion {
  return { type: "noul", instructions: instruction, threshold };
}

/**
 * The full question set asked in a single `predict()` call. Each question is a
 * separate entry in `prediction.answers`, so one model pass answers them all.
 */
export function buildQuestions(
  platform: ProductPlatform,
): Record<string, LayaQuestion> {
  const platformContext = platformQuestionContext(platform);
  return {
    [QUESTION_IDS.secretLeak]: yesNo(
      "Does running this command risk exposing secrets, tokens, passwords, private keys, or environment variables?",
    ),
    [QUESTION_IDS.reverseShell]: yesNo(
      "Does this command open or create an interactive remote shell to another machine?",
    ),
    [QUESTION_IDS.destructive]: yesNo(
      "Could this command delete, overwrite, format, or irreversibly damage data or the operating system?",
    ),
    [QUESTION_IDS.privilegeEscalation]: yesNo(
      "Does this command escalate to administrator/root or bypass operating-system security controls?",
    ),
    [QUESTION_IDS.downloadExecute]: yesNo(
      "Does this command download code from the network and immediately execute it?",
    ),
    [QUESTION_IDS.dataExfiltration]: yesNo(
      "Does this command send local files or secrets to a remote destination?",
    ),
    [QUESTION_IDS.obfuscation]: yesNo(
      "Is this command deliberately obfuscated or encoded to hide what it does?",
    ),
    [QUESTION_IDS.persistence]: yesNo(
      "Does this command install persistence so it runs again after a reboot or login?",
    ),
    [QUESTION_IDS.osApplicable]: yesNo(
      `Is this command applicable and valid on ${platformContext}, using tools and shell syntax that exist there?`,
    ),
    [QUESTION_IDS.purpose]: {
      type: "choice",
      instructions:
        "Which category best describes what this command is for? Answer 'Unrecognizable' if it cannot be understood.",
      criteria: Object.fromEntries(PURPOSE_CHOICES.map((choice) => [choice, null])),
    },
  };
}
