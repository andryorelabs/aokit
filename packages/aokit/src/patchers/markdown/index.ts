import { upsertRegion } from "./regions.ts";

/** A Markdown region owned by one Module. */
export interface MarkdownRegion {
  readonly module: string;
  readonly content: string;
}

/**
 * Writes a Module's own marker region into Markdown text. Only the lines between
 * the Module's own start and end markers change; a new region goes after the last
 * aokit region, or at the end of the file when there is none.
 */
export function appendRegion(text: string, region: MarkdownRegion): string {
  return upsertRegion(text, { id: region.module, content: region.content }, "afterLastRegion");
}
