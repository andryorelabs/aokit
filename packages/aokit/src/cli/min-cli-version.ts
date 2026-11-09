const releasesUrl = "https://github.com/andryorelabs/aokit/releases";

/**
 * Whether a CLI version satisfies a Registry `minCliVersion`. The CLI version's pre-release and
 * build parts are ignored, so `0.1.0-next.0` reads a Registry that requires `0.1.0`.
 */
export function meetsMinCliVersion(cliVersion: string, minCliVersion: string): boolean {
  const [coreVersion = cliVersion] = cliVersion.split(/[-+]/, 1);
  return Bun.semver.order(coreVersion, minCliVersion) >= 0;
}

/**
 * The fix shown whenever a Registry needs a newer CLI version: run that version through `bunx`
 * or download the standalone binary.
 */
export function minCliVersionFix(version: string): string {
  return `Update the aokit CLI to ${version} or newer: run \`bunx aokit@${version}\` or download the binary from ${releasesUrl}, then run the command again.`;
}
