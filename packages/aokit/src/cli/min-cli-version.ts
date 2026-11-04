const releasesUrl = "https://github.com/AndryOre/aokit/releases";

/**
 * The fix shown whenever a Registry needs a newer CLI version: run that version through `bunx`
 * or download the standalone binary.
 */
export function minCliVersionFix(version: string): string {
  return `Update the aokit CLI to ${version} or newer: run \`bunx aokit@${version}\` or download the binary from ${releasesUrl}, then run the command again.`;
}
