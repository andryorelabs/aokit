import { afterEach, describe, expect, test } from "bun:test";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { checkCommand } from "../../src/cli/commands/check.ts";
import {
  builtRegistry,
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  editLockfileJson,
  temporaryDirectory,
} from "../diff/support.ts";
import { type JsonObject, objectAt } from "../helpers/update-json.ts";

afterEach(cleanTemporaryDirectories);

function official(lockfile: JsonObject): JsonObject {
  return objectAt(lockfile, "registries", "official");
}

describe("aokit check with several Registries and versions", () => {
  test("a Project locking two Registries is checked against both", async () => {
    const registry = await builtRegistry();
    const project = await createProject(registry);
    await editLockfileJson(project, (lockfile) => {
      const registries = objectAt(lockfile, "registries");
      registries["another"] = { ...official(lockfile) };
    });
    const envelope = await runCommand(checkCommand, commandContext, { directory: project });
    expect(envelope).toMatchObject({ ok: true, data: { modules: [] } });
  });

  test("the newest of several published versions is the one reported", async () => {
    const source = await writeRegistrySourceFixture();
    const registry = await temporaryDirectory();
    await buildRegistry(source, registry);
    const project = await createProject(registry);
    const newerSource = join(await temporaryDirectory(), "source");
    await cp(source, newerSource, { recursive: true });
    const modulePath = join(newerSource, "oxc", "module.ts");
    const text = await readFile(modulePath, "utf8");
    await writeFile(modulePath, text.replace('version: "1.0.0",', 'version: "1.2.0",'), "utf8");
    await buildRegistry(newerSource, registry);
    const envelope = await runCommand(checkCommand, commandContext, { directory: project });
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: "UPDATE_AVAILABLE" },
      data: { modules: [{ name: "oxc", current: "1.0.0", available: "1.2.0" }] },
    });
  });
});
