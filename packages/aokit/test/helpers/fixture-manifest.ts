import { type ModuleManifest, parseManifest } from "@aokit/module";

/**
 * Parses a fixture Module manifest, defaulting `version` to 1.0.0 and `description` to a fixed
 * sentence so fixtures only spell out what the test is about.
 */
export function fixtureManifest(raw: Record<string, unknown>): ModuleManifest {
  return parseManifest({ version: "1.0.0", description: "Fixture Module.", ...raw });
}
