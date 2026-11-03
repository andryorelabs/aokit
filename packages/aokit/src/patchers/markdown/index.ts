/** A Markdown region owned by one Module. */
export interface MarkdownRegion {
  readonly module: string;
  readonly content: string;
}

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Writes a Module's own marker region into Markdown text. Only the lines between
 * the Module's own start and end markers change; the region is appended when absent.
 */
export function appendRegion(text: string, region: MarkdownRegion): string {
  const begin = `<!-- aokit:begin ${region.module} -->`;
  const end = `<!-- aokit:end ${region.module} -->`;
  const block = `${begin}\n${region.content}\n${end}`;
  const beginIndex = text.indexOf(begin);
  if (beginIndex === -1) {
    const separator =
      text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return `${text}${separator}${block}\n`;
  }
  const endPattern = new RegExp(escapeForPattern(end));
  const tail = text.slice(beginIndex + begin.length);
  const endMatch = endPattern.exec(tail);
  if (endMatch === null) {
    throw new Error(`Region "${region.module}" has a start marker but no end marker`);
  }
  const endIndex = beginIndex + begin.length + endMatch.index + end.length;
  return `${text.slice(0, beginIndex)}${block}${text.slice(endIndex)}`;
}
