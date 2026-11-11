import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { diffCommand } from "../../src/cli/commands/diff.ts";
import {
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  editLockfileJson,
  temporaryDirectory,
} from "./support.ts";

afterEach(cleanTemporaryDirectories);

async function bundledProject(): Promise<string> {
  const directory = join(await temporaryDirectory(), "app");
  const envelope = await runCommand(createCommand, commandContext, {
    directory,
    modules: "oxc,knip",
    yes: true,
    install: false,
    git: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  return directory;
}

function runDiff(directory: string, to?: string) {
  return runCommand(diffCommand, commandContext, {
    directory,
    ...(to === undefined ? {} : { to }),
  });
}

describe("aokit diff edge cases", () => {
  test("a binary working file is flagged binary and has no hunks", async () => {
    const project = await bundledProject();
    await writeFile(join(project, "knip.json"), new Uint8Array([0xff, 0xfe, 0x00, 0x80]));
    const envelope = await runDiff(project);
    if (!envelope.ok) throw new Error(envelope.error.message);
    const data = diffCommand.output.parse(envelope.data);
    const file = data.files.find((entry) => entry.path === "knip.json");
    expect(file).toMatchObject({ status: "modified", binary: true, hunks: [] });
  });

  test("a managed path that is a directory is an IO_ERROR", async () => {
    const project = await bundledProject();
    await rm(join(project, "knip.json"));
    await mkdir(join(project, "knip.json"));
    const envelope = await runDiff(project);
    expect(envelope).toMatchObject({ ok: false, error: { code: "IO_ERROR" } });
  });

  test("a malformed Lockfile is invalid input", async () => {
    const project = await bundledProject();
    await writeFile(join(project, "aokit.lock.json"), "{ not json");
    const envelope = await runDiff(project);
    expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  test("broken aokit markers in a Region file fall back to the plain Render", async () => {
    const project = await bundledProject();
    await writeFile(join(project, "AGENTS.md"), "<!-- aokit:begin aokit:header -->\nmine\n");
    const envelope = await runDiff(project);
    if (!envelope.ok) throw new Error(envelope.error.message);
    const data = diffCommand.output.parse(envelope.data);
    expect(data.files.find((entry) => entry.path === "AGENTS.md")?.status).toBe("modified");
  });

  test("a Lockfile that lists no Registry is invalid input for --to", async () => {
    const project = await bundledProject();
    await editLockfileJson(project, (lockfile) => {
      lockfile["registries"] = {};
    });
    const envelope = await runDiff(project, "2026.11.1");
    expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
});

const secondCatalog = `${JSON.stringify(
  {
    release: "2026.11.1",
    dependencies: { oxfmt: "0.75.0", oxlint: "1.90.0" },
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
  answers: { router: { type: "string", default: "none" } },
  files: [{ from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" }],
  deps: { devDependencies: { oxlint: { range: "catalog", pinGroup: "oxc" } } },
};
`;

async function projectWhoseNextReleaseDropsNotes(): Promise<string> {
  const first = await writeRegistrySourceFixture();
  const registryPath = await temporaryDirectory();
  await buildRegistry(first, registryPath);
  const directory = await createProject(registryPath);
  const second = await writeRegistrySourceFixture();
  await writeFile(join(second, "oxc/module.ts"), secondModule, "utf8");
  await writeFile(join(second, "catalog/2026.11.1.json"), secondCatalog, "utf8");
  await buildRegistry(second, registryPath);
  return directory;
}

describe("aokit diff --to when the target Release drops a file", () => {
  test("a dropped managed file still on disk is reported removed", async () => {
    const directory = await projectWhoseNextReleaseDropsNotes();
    const envelope = await runDiff(directory, "2026.11.1");
    if (!envelope.ok) throw new Error(envelope.error.message);
    const data = diffCommand.output.parse(envelope.data);
    expect(data.files.find((entry) => entry.path === "notes.md")?.status).toBe("removed");
  });

  test("a dropped managed file already deleted is not listed", async () => {
    const directory = await projectWhoseNextReleaseDropsNotes();
    await rm(join(directory, "notes.md"));
    const envelope = await runDiff(directory, "2026.11.1");
    if (!envelope.ok) throw new Error(envelope.error.message);
    const data = diffCommand.output.parse(envelope.data);
    expect(data.files.some((entry) => entry.path === "notes.md")).toBe(false);
  });

  test("a managed file of the target Release that is missing is reported missing", async () => {
    const directory = await projectWhoseNextReleaseDropsNotes();
    await rm(join(directory, ".oxlintrc.json"));
    const envelope = await runDiff(directory, "2026.11.1");
    if (!envelope.ok) throw new Error(envelope.error.message);
    const data = diffCommand.output.parse(envelope.data);
    expect(data.files.find((entry) => entry.path === ".oxlintrc.json")?.status).toBe("missing");
  });
});

const randomMigratingModule = `export default {
  name: "oxc",
  version: "1.1.0",
  description: "Fixture Module.",
  provides: ["lint", "format"],
  answers: { router: { type: "string", default: "none" } },
  files: [
    { from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" },
    { from: "files/nested/notes.md", to: "notes.md", target: "root" },
  ],
  deps: { devDependencies: { oxlint: { range: "catalog", pinGroup: "oxc" } } },
  migrations: [
    { from: ">=1 <2", to: "1.1.0", stage: "before", script: "migrations/seed.before.js" },
  ],
};
`;

const randomMigrationScript = `import { defineMigration } from "@aokit/module";

export default defineMigration(({ answers, context }) => ({
  ...answers,
  router: \`seed-\${context.random()}-\${context.now.getTime()}\`,
}));
`;

describe("aokit diff --to with a Migration", () => {
  test("the Migration receives the deterministic clock and random source", async () => {
    const first = await writeRegistrySourceFixture();
    const registryPath = await temporaryDirectory();
    await buildRegistry(first, registryPath);
    const directory = await createProject(registryPath);
    const second = await writeRegistrySourceFixture();
    await mkdir(join(second, "oxc/migrations"), { recursive: true });
    await writeFile(join(second, "oxc/module.ts"), randomMigratingModule, "utf8");
    await writeFile(join(second, "oxc/migrations/seed.before.ts"), randomMigrationScript, "utf8");
    await writeFile(join(second, "oxc/files/nested/notes.md"), "# {{router}}\n", "utf8");
    await writeFile(join(second, "catalog/2026.11.1.json"), secondCatalog, "utf8");
    await buildRegistry(second, registryPath);
    const envelope = await runDiff(directory, "2026.11.1");
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(diffCommand.output.parse(envelope.data).diff).toContain("+# seed-0-0");
  });
});
