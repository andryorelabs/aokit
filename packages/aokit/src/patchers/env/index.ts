const KEY_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function existingKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split("\n")) {
    const match = KEY_PATTERN.exec(line);
    if (match?.[1] !== undefined) keys.add(match[1]);
  }
  return keys;
}

/**
 * Adds missing keys to `.env` text. An existing key is never overwritten,
 * whatever its value; new keys are appended in sorted order.
 */
export function addEnv(text: string, entries: Readonly<Record<string, string>>): string {
  const present = existingKeys(text);
  const additions = Object.keys(entries)
    .toSorted()
    .filter((key) => !present.has(key))
    .map((key) => `${key}=${entries[key]}`);
  if (additions.length === 0) return text;
  const separator = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${separator}${additions.join("\n")}\n`;
}
