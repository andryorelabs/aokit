import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand, type CommandContext } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { type JsonObject, parseJsonObject } from "../helpers/update-json.ts";

const temporaryDirectories: string[] = [];

export const commandContext: CommandContext = { version: cliVersion, env: {}, commands: [] };

export async function cleanTemporaryDirectories(): Promise<void> {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
}

export async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "aokit-lifecycle-"));
  temporaryDirectories.push(path);
  return path;
}

/** Builds a fixture Registry; `edit` may rewrite the Registry source before the build. */
export async function builtRegistry(edit?: (sourceRoot: string) => Promise<void>): Promise<string> {
  const source = await writeRegistrySourceFixture();
  temporaryDirectories.push(source);
  await edit?.(source);
  const out = await temporaryDirectory();
  await buildRegistry(source, out);
  return out;
}

/** Creates a Project with the `oxc` Module from the given Registry and returns its directory. */
export async function createProject(registry: string): Promise<string> {
  const directory = join(await temporaryDirectory(), "app");
  const envelope = await runCommand(createCommand, commandContext, {
    directory,
    modules: "oxc",
    registry,
    yes: true,
    install: false,
  });
  if (!envelope.ok) {
    throw new Error(envelope.error.message);
  }
  return directory;
}

/** Rewrites the Lockfile of a Project through `edit`, typed as a JSON object. */
export async function editLockfileJson(
  directory: string,
  edit: (lockfile: JsonObject) => void,
): Promise<void> {
  const path = join(directory, "aokit.lock.json");
  const lockfile = parseJsonObject(await readFile(path, "utf8"));
  edit(lockfile);
  await writeFile(path, `${JSON.stringify(lockfile, null, 2)}\n`, "utf8");
}
