import { setVerbose } from "./logger";

export type ExtensionConfig = {
  enabled: boolean;
  verbose: boolean;
};

export const DEFAULT_CONFIG: ExtensionConfig = {
  enabled: true,
  // Privacy default: never write the raw command to the log.
  verbose: false,
};

const CONFIG_KEY = "layaGuard.config";

export async function loadConfig(): Promise<ExtensionConfig> {
  try {
    const stored = await chrome.storage.sync.get(CONFIG_KEY);
    const value = stored[CONFIG_KEY];
    if (value && typeof value === "object") {
      return { ...DEFAULT_CONFIG, ...(value as Partial<ExtensionConfig>) };
    }
  } catch {
    // Storage unavailable: fall back to defaults.
  }
  return { ...DEFAULT_CONFIG };
}

export async function saveConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.sync.set({ [CONFIG_KEY]: config });
  setVerbose(config.verbose);
}
