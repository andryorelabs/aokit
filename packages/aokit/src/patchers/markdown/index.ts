import { upsertRegion } from "./regions.ts";

/** A marker region owned by one Module. */
export interface MarkdownRegion {
  readonly module: string;
  readonly content: string;
  readonly path?: string;
}

/**
 * Writes a Module's own marker region into text; `path` picks the comment markers (Markdown when absent). Only the lines between
 * the Module's own start and end markers change; a new region goes after the last
 * aokit region, or at the end of the file when there is none.
 */
export function appendRegion(text: string, region: MarkdownRegion): string {
  return upsertRegion(
    text,
    { id: region.module, content: region.content },
    "afterLastRegion",
    region.path,
  );
}
