// FNV-1a, used only to give each logged attempt a stable short id without
// storing the raw command.

export function hashCommand(command: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < command.length; index += 1) {
    hash ^= command.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
