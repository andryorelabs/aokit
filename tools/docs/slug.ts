export function githubSlug(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(`[^`]*`)|<[^>]+>/g, (_match, code: string | undefined) => code ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
}

export function headingSlugs(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match?.[1]) continue;
    const base = githubSlug(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }
  return slugs;
}
