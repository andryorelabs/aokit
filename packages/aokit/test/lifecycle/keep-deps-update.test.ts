import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import {
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  editLockfileJson,
  temporaryDirectory,
} from "../diff/support.ts";
import { objectAt, parseJsonObject, valueAt } from "../helpers/update-json.ts";

afterEach(cleanTemporaryDirectories);

const secondCatalog = `${JSON.stringify(
  {
    release: "2026.11.1",
    dependencies: { oxfmt: "0.75.0", oxlint: "1.91.0" },
    pinGroups: { oxc: ["oxlint", "oxfmt"] },
  },
  null,
  2,
)}\n`;

const secondModule = `export default {
  name: "oxc",
  version: "1.1.0",
  description: "Fixture Module.",
  provides: ["lint", "format"],
  files: [
    { from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" },
    { from: "files/bad/package.json", to: "sub/package.json", target: "root" },
  ],
  deps: { devDependencies: { oxlint: { range: "catalog", pinGroup: "oxc" } } },
};
`;

async function publishSecondRelease(out: string): Promise<void> {
  const source = await writeRegistrySourceFixture();
  await mkdir(join(source, "oxc/files/bad"), { recursive: true });
  await Promise.all([
    writeFile(join(source, "oxc/module.ts"), secondModule, "utf8"),
    writeFile(join(source, "oxc/files/bad/package.json"), '{ "name": "sub", }\n', "utf8"),
    writeFile(join(source, "catalog/2026.11.1.json"), secondCatalog, "utf8"),
  ]);
  await buildRegistry(source, out);
}

async function gitIn(directory: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(
    [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  );
  await child.exited;
}

async function updatableProject(): Promise<string> {
  const source = await writeRegistrySourceFixture();
  const registry = await temporaryDirectory();
  await buildRegistry(source, registry);
  const directory = await createProject(registry);
  await publishSecondRelease(registry);
  return directory;
}

async function commitAll(directory: string): Promise<void> {
  await gitIn(directory, "init", "-q");
  await gitIn(directory, "add", "-A");
  await gitIn(directory, "commit", "-q", "-m", "init");
}

test("update keeps a user dependency the target Release does not resolve", async () => {
  const directory = await updatableProject();
  await editLockfileJson(directory, (lockfile) => {
    objectAt(lockfile, "deps")["mine"] = {
      version: "9.9.9",
      owners: [],
      pinned: false,
      source: "user",
    };
  });
  await commitAll(directory);
  const envelope = await runCommand(updateCommand, commandContext, {
    directory,
    yes: true,
    install: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  const lockfile = parseJsonObject(await readFile(join(directory, "aokit.lock.json"), "utf8"));
  expect(valueAt(lockfile, "deps", "mine", "version")).toBe("9.9.9");
  expect(valueAt(lockfile, "deps", "mine", "source")).toBe("user");
});

test("update keeps a nested package.json the Module ships and still pins the root dependency", async () => {
  const directory = await updatableProject();
  await commitAll(directory);
  const envelope = await runCommand(updateCommand, commandContext, {
    directory,
    yes: true,
    install: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  expect(await readFile(join(directory, "sub/package.json"), "utf8")).toContain('"name": "sub"');
  const rootPackage = parseJsonObject(await readFile(join(directory, "package.json"), "utf8"));
  expect(valueAt(rootPackage, "devDependencies", "oxlint")).toBeDefined();
});
