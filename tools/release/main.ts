import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { extractChangelogSection } from "./changelog-section.ts";

const changelogPath = "CHANGELOG.md";
const allowMissingFlag = "--allow-missing";
const usage = `usage: bun tools/release/main.ts <version> <output file> [${allowMissingFlag}]`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Returns the release notes of a version: its `CHANGELOG.md` section. With `allowMissing`, a
 * missing or empty section becomes a warning and a one-line placeholder, for a dry run that has
 * no tag to release.
 */
function releaseNotes(version: string, allowMissing: boolean): string {
  const changelogText = readFileSync(changelogPath, "utf8");
  try {
    return extractChangelogSection(changelogText, version);
  } catch (error) {
    if (!allowMissing) throw error;
    console.log(`::warning::${errorMessage(error)}`);
    return `No CHANGELOG.md section for ${version} (dry run without a tag).`;
  }
}

/**
 * Writes the release notes of a version to a file, run by `.github/workflows/release.yml` from
 * the repository root. Exits 1 with a GitHub error annotation when the section is missing or
 * empty and `--allow-missing` is not passed.
 */
function main(parameters: readonly string[]): void {
  const flags = parameters.filter((parameter) => parameter.startsWith("--"));
  const [version, outputPath, ...extra] = parameters.filter(
    (parameter) => !parameter.startsWith("--"),
  );
  const unknownFlag = flags.find((flag) => flag !== allowMissingFlag);
  if (version === undefined || outputPath === undefined || extra.length > 0 || unknownFlag) {
    throw new Error(usage);
  }
  const notes = releaseNotes(version, flags.includes(allowMissingFlag));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${notes}\n`);
  console.log(`Release notes for ${version} written to ${outputPath}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.log(`::error::${errorMessage(error)}`);
  process.exit(1);
}
