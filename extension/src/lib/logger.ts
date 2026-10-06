import { hashCommand } from "./hash";
import type { AttemptLogEntry, AttemptSource, Verdict } from "./types";

const PREFIX = "[laya-guard]";
export const ATTEMPT_STORAGE_KEY = "layaGuard.attempts";
const MAX_ATTEMPTS = 200;

let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function isVerbose(): boolean {
  return verbose;
}

export function logInfo(message: string, data?: unknown): void {
  if (data === undefined) console.info(`${PREFIX} ${message}`);
  else console.info(`${PREFIX} ${message}`, data);
}

export function logWarn(message: string, data?: unknown): void {
  if (data === undefined) console.warn(`${PREFIX} ${message}`);
  else console.warn(`${PREFIX} ${message}`, data);
}

export function logError(message: string, data?: unknown): void {
  if (data === undefined) console.error(`${PREFIX} ${message}`);
  else console.error(`${PREFIX} ${message}`, data);
}

/** Redact the raw command unless the user opted into verbose logging. */
export function previewCommand(command: string): string {
  if (verbose) return command;
  const firstLine = command.split("\n")[0]?.trim() ?? "";
  const head = firstLine.slice(0, 24);
  return `${head}${firstLine.length > 24 ? "…" : ""} (${command.length} chars, #${hashCommand(command)})`;
}

export function buildAttemptEntry(options: {
  id: number;
  source: AttemptSource;
  url: string;
  command: string;
  verdict: Verdict;
}): AttemptLogEntry {
  const { verdict } = options;
  return {
    id: options.id,
    at: new Date().toISOString(),
    source: options.source,
    url: options.url,
    platform: verdict.platform,
    commandLength: options.command.length,
    commandPreview: previewCommand(options.command),
    commandHash: hashCommand(options.command),
    level: verdict.level,
    score: verdict.score,
    engine: verdict.engine,
    findingIds: verdict.findings.map((finding) => finding.id),
    heuristicMs: verdict.timings.heuristicMs,
    ...(verdict.timings.modelMs !== undefined ? { modelMs: verdict.timings.modelMs } : {}),
  };
}

function storageArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === "undefined" || !chrome.storage) return null;
  return chrome.storage.session ?? chrome.storage.local ?? null;
}

export async function appendAttempt(entry: AttemptLogEntry): Promise<void> {
  const area = storageArea();
  if (!area) return;
  try {
    const stored = await area.get(ATTEMPT_STORAGE_KEY);
    const attempts = Array.isArray(stored[ATTEMPT_STORAGE_KEY])
      ? (stored[ATTEMPT_STORAGE_KEY] as AttemptLogEntry[])
      : [];
    attempts.push(entry);
    await area.set({ [ATTEMPT_STORAGE_KEY]: attempts.slice(-MAX_ATTEMPTS) });
  } catch (error) {
    logWarn("could not persist attempt log", error);
  }
}

export async function readAttempts(): Promise<AttemptLogEntry[]> {
  const area = storageArea();
  if (!area) return [];
  try {
    const stored = await area.get(ATTEMPT_STORAGE_KEY);
    return Array.isArray(stored[ATTEMPT_STORAGE_KEY])
      ? (stored[ATTEMPT_STORAGE_KEY] as AttemptLogEntry[])
      : [];
  } catch {
    return [];
  }
}

export async function clearAttempts(): Promise<void> {
  const area = storageArea();
  if (!area) return;
  try {
    await area.set({ [ATTEMPT_STORAGE_KEY]: [] });
  } catch (error) {
    logWarn("could not clear attempt log", error);
  }
}
