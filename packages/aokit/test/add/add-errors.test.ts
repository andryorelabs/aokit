import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { type JsonObject, objectAt, parseJsonObject } from "../helpers/update-json.ts";

const context = { version: cliVersion, env: {}, commands: [] };
const workspace = mkdtempSync(join(tmpdir(), "aokit-add-errors-"));
let counter = 0;

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function createProject(modules = "oxc"): Promise<string> {
  counter += 1;
  const directory = join(workspace, `app dir ${counter}`);
  const envelope = await runCommand(createCommand, context, {
    directory,
    modules,
    yes: true,
    install: false,
    git: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  return directory;
}

function add(directory: string, extra: Record<string, unknown> = {}) {
  return runCommand(addCommand, context, {
    modules: ["knip"],
    directory,
    yes: true,
    install: false,
    allowDirty: true,
    ...extra,
  });
}

async function editLockfile(
  directory: string,
  edit: (lockfile: JsonObject) => void,
): Promise<void> {
  const path = join(directory, "aokit.lock.json");
  const lockfile = parseJsonObject(await readFile(path, "utf8"));
  edit(lockfile);
  await writeFile(path, `${JSON.stringify(lockfile, null, 2)}\n`);
}

describe("aokit add rejections", () => {
  test("a Module already in the Project is INVALID_INPUT", async () => {
    const directory = await createProject("oxc,knip");
    const envelope = await add(directory);
    expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    if (!envelope.ok) expect(envelope.error.message).toContain("knip");
  });

  test("a locked version the Registry no longer holds is MODULE_VERSION_UNAVAILABLE", async () => {
    const directory = await createProject();
    await editLockfile(directory, (lockfile) => {
      objectAt(lockfile, "modules", "oxc")["version"] = "999.0.0";
    });
    const envelope = await add(directory);
    expect(envelope).toMatchObject({ ok: false, error: { code: "MODULE_VERSION_UNAVAILABLE" } });
  });

  test("a Lockfile that lists no Registry is rejected", async () => {
    const directory = await createProject();
    await editLockfile(directory, (lockfile) => {
      lockfile["registries"] = {};
    });
    const envelope = await add(directory);
    expect(envelope.ok).toBe(false);
  });

  test("a Release the Registry has no Catalog for is MODULE_VERSION_UNAVAILABLE", async () => {
    const directory = await createProject();
    await editLockfile(directory, (lockfile) => {
      objectAt(lockfile, "registries", "official")["release"] = "1999.1.1";
    });
    const envelope = await add(directory);
    expect(envelope.ok).toBe(false);
  });
});

const answeredKnip = `export default {
  name: "knip",
  version: "2.1.0",
  description: "Fixture unused code finder.",
  provides: ["unused-code"],
  requires: ["lint"],
  answers: { level: { type: "string", default: "low" } },
};
`;

async function fixtureRegistry(): Promise<string> {
  const source = await writeRegistrySourceFixture();
  await writeFile(join(source, "knip/module.ts"), answeredKnip, "utf8");
  const out = mkdtempSync(join(workspace, "registry-"));
  await buildRegistry(source, out);
  await rm(source, { recursive: true, force: true });
  return out;
}

describe("aokit add with a Registry of its own", () => {
  test("an answer is quoted into the reproduce command", async () => {
    const registry = await fixtureRegistry();
    counter += 1;
    const directory = join(workspace, `fixture-${counter}`);
    const created = await runCommand(createCommand, context, {
      directory,
      modules: "oxc",
      registry,
      yes: true,
      install: false,
      git: false,
    });
    expect(created.ok).toBe(true);
    const envelope = await add(directory, { answer: ["knip.level=very high"] });
    if (!envelope.ok) throw new Error(envelope.error.message);
    const data = addCommand.output.parse(envelope.data);
    expect(data.reproduce).toContain("--answer 'knip.level=very high'");
  });
});

describe("aokit add reproduce", () => {
  test("quotes a directory with a space and keeps locked answers", async () => {
    const directory = await createProject();
    await editLockfile(directory, (lockfile) => {
      objectAt(lockfile, "modules", "oxc")["answers"] = { label: "x", count: 2, flag: true };
    });
    const envelope = await add(directory, { dryRun: true });
    if (!envelope.ok) throw new Error(envelope.error.message);
    const data = addCommand.output.parse(envelope.data);
    expect(data.reproduce).toContain(`--directory '${directory}'`);
  });
});
