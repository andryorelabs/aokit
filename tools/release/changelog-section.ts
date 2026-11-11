const sectionHeading = /^## \[?([^\]\s]+)\]?(?:\s.*)?$/;
const anyHeading = /^#{1,6}\s/;
const linkDefinition = /^\[[^\]]+\]:\s+\S+$/;

function isSectionHeadingFor(line: string, version: string): boolean {
  return sectionHeading.exec(line)?.[1] === version;
}

function hasEntries(lines: readonly string[]): boolean {
  return lines.some((line) => line.trim() !== "" && !anyHeading.test(line));
}

/**
 * Returns the body of the `## [<version>]` section of a Keep a Changelog file: the lines between
 * its heading and the next `## ` heading, without the link definitions at the foot of the file.
 * Throws when no section names the version, or when the section holds no entry besides headings.
 */
export function extractChangelogSection(changelogText: string, version: string): string {
  const lines = changelogText.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => isSectionHeadingFor(line, version));
  if (headingIndex === -1) {
    throw new Error(`CHANGELOG.md has no section for ${version}`);
  }
  const rest = lines.slice(headingIndex + 1);
  const nextSection = rest.findIndex((line) => line.startsWith("## "));
  const body = (nextSection === -1 ? rest : rest.slice(0, nextSection)).filter(
    (line) => !linkDefinition.test(line),
  );
  if (!hasEntries(body)) {
    throw new Error(`CHANGELOG.md section for ${version} is empty`);
  }
  return body.join("\n").trim();
}
