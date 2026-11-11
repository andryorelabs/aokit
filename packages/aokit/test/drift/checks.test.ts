import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand, type CommandContext } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { objectAt, parseJsonObject, type JsonObject } from "../helpers/update-json.ts";

const context: CommandContext = { version: cliVersion, env: {}, commands: exposedCommands };
const workspaces: string[] = [];

afterAll(() => {
  for (const path of workspaces) rmSync(path, { recursive: true, force: true });
});

async function createProject(modules = "oxc"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "aokit-checks-"));
  workspaces.push(root);
  const directory = join(root, "app");
  const created = await runCommand(createCommand, context, {
    directory,
    modules,
    yes: true,
    install: false,
    git: false,
  });
  expect(created.ok).toBe(true);
  return directory;
}

function rewriteLockfile(directory: string, edit: (lockfile: JsonObject) => void): void {
  const path = join(directory, "aokit.lock.json");
  const lockfile = parseJsonObject(readFileSync(path, "utf8"));
  edit(lockfile);
  writeFileSync(path, `${JSON.stringify(lockfile, null, 2)}\n`);
}

async function problems(directory: string) {
  const envelope = await runCommand(doctorCommand, context, { directory });
  return doctorCommand.output.parse(envelope.data).problems;
}

function firstKey(record: JsonObject): string {
  const [name] = Object.keys(record);
  if (name === undefined) throw new Error("expected a non-empty record");
  return name;
}

test("a Registry whose source cannot be parsed is reported as a Registry problem", async () => {
  const directory = await createProject();
  rewriteLockfile(directory, (lockfile) => {
    const registries = objectAt(lockfile, "registries");
    objectAt(lockfile, "registries", firstKey(registries))["source"] = "github:not-a-source";
  });
  const found = await problems(directory);
  expect(found.some((problem) => problem.kind === "registry")).toBe(true);
});

test("a Module version the Registry does not publish is reported", async () => {
  const directory = await createProject();
  let name = "";
  rewriteLockfile(directory, (lockfile) => {
    const modules = objectAt(lockfile, "modules");
    name = firstKey(modules);
    objectAt(lockfile, "modules", name)["version"] = "99.0.0";
  });
  const found = await problems(directory);
  const missing = found.find((problem) => problem.message.includes(`${name}@99.0.0`));
  expect(missing?.kind).toBe("registry");
  expect(missing?.fix).toBe("aokit recopy");
});

test("a package.json that is missing or not JSON counts its dependencies as missing", async () => {
  const directory = await createProject();
  const manifestPath = join(directory, "package.json");
  writeFileSync(manifestPath, "{ not json");
  const malformed = await problems(directory);
  expect(malformed.some((problem) => problem.kind === "deps")).toBe(true);
  rmSync(manifestPath);
  const missing = await problems(directory);
  expect(missing.some((problem) => problem.kind === "deps")).toBe(true);
});

test("a dependency whose package.json version differs from the Lockfile is reported", async () => {
  const directory = await createProject();
  const lockfile = parseJsonObject(readFileSync(join(directory, "aokit.lock.json"), "utf8"));
  const name = firstKey(objectAt(lockfile, "deps"));
  const manifestPath = join(directory, "package.json");
  const manifest = parseJsonObject(readFileSync(manifestPath, "utf8"));
  for (const section of ["dependencies", "devDependencies"]) {
    const dependencies = manifest[section];
    if (typeof dependencies === "object" && dependencies !== null && name in dependencies) {
      Object.assign(dependencies, { [name]: "git+https://example.com/pinned.git" });
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const found = await problems(directory);
  const drifted = found.find((problem) => problem.message.startsWith(`Dependency ${name} is `));
  expect(drifted?.kind).toBe("deps");
  expect(drifted?.fix).toBe("aokit restore package.json");
});
