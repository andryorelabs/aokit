const unreleasedHeading = "## [Unreleased]";
const unreleasedLink = /^\[Unreleased\]:\s+(\S+)\/compare\/v([^.\s][^\s]*?)\.\.\.HEAD\s*$/m;
const anyHeading = /^#{1,6}\s/;

function hasEntries(lines: readonly string[]): boolean {
  return lines.some((line) => line.trim() !== "" && !anyHeading.test(line));
}

/**
 * Moves the `[Unreleased]` entries of a Keep a Changelog file into a new `## [<version>] - <date>`
 * section, leaves an empty `[Unreleased]` above it, and rewrites the link definitions: `[Unreleased]`
 * compares the new tag with `HEAD`, and the new version compares the previous tag with itself.
 * Throws when there is no `[Unreleased]` heading or link, when it holds no entry, or when the
 * version already has a section.
 */
export function promoteUnreleased(changelogText: string, version: string, date: string): string {
  const lines = changelogText.split("\n");
  const headingIndex = lines.indexOf(unreleasedHeading);
  if (headingIndex === -1) throw new Error(`CHANGELOG.md has no "${unreleasedHeading}" heading`);
  if (lines.some((line) => line.startsWith(`## [${version}]`))) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const link = unreleasedLink.exec(changelogText);
  const baseUrl = link?.[1];
  const previousVersion = link?.[2];
  if (baseUrl === undefined || previousVersion === undefined) {
    throw new Error("CHANGELOG.md has no [Unreleased] compare link to move");
  }
  const rest = lines.slice(headingIndex + 1);
  const nextSection = rest.findIndex((line) => line.startsWith("## "));
  const bodyEnd = nextSection === -1 ? rest.length : nextSection;
  const body = rest.slice(0, bodyEnd);
  if (!hasEntries(body)) throw new Error("CHANGELOG.md [Unreleased] holds no entry to release");
  const before = lines.slice(0, headingIndex);
  const after = rest.slice(bodyEnd);
  const promoted = [unreleasedHeading, "", `## [${version}] - ${date}`, ...body, ...after].join(
    "\n",
  );
  const unreleasedDefinition = `[Unreleased]: ${baseUrl}/compare/v${version}...HEAD`;
  const versionDefinition = `[${version}]: ${baseUrl}/compare/v${previousVersion}...v${version}`;
  return [...before, promoted]
    .join("\n")
    .replace(unreleasedLink, `${unreleasedDefinition}\n${versionDefinition}`);
}
