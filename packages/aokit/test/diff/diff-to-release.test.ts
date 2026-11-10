import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { diffCommand } from "../../src/cli/commands/diff.ts";
import {
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  temporaryDirectory,
} from "./support.ts";

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
  answers: { router: { type: "string", default: "none" } },
  files: [
    { from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" },
    { from: "files/nested/notes.md", to: "notes.md", target: "root" },
  ],
  deps: { devDependencies: { oxlint: { range: "catalog", pinGroup: "oxc" } } },
  migrations: [
    { from: ">=1 <2", to: "1.1.0", stage: "before", script: "migrations/rename.before.js" },
  ],
};
`;

const renameScript = `import { defineMigration } from "@aokit/module";

export default defineMigration(({ answers }) => ({ ...answers, router: "tanstack" }));
`;

async function twoReleaseProject(): Promise<{ directory: string }> {
  const first = await writeRegistrySourceFixture();
  const registryPath = await temporaryDirectory();
  await buildRegistry(first, registryPath);
  const directory = await createProject(registryPath);
  const second = await writeRegistrySourceFixture();
  await mkdir(join(second, "oxc/migrations"), { recursive: true });
  await writeFile(join(second, "oxc/module.ts"), secondModule, "utf8");
  await writeFile(join(second, "oxc/migrations/rename.before.ts"), renameScript, "utf8");
  await writeFile(
    join(second, "oxc/files/.oxlintrc.json"),
    `{\n  "ignorePatterns": [],\n  "rules": { "no-debugger": "error" }\n}\n`,
    "utf8",
  );
  await writeFile(join(second, "oxc/files/nested/notes.md"), "# {{name}} ({{router}})\n", "utf8");
  await writeFile(join(second, "catalog/2026.11.1.json"), secondCatalog, "utf8");
  await buildRegistry(second, registryPath);
  return { directory };
}

async function runDiffTo(directory: string, to: string) {
  return runCommand(diffCommand, commandContext, { directory, to });
}

describe("aokit diff --to", () => {
  test("a pristine Project shows what the target Release changes and writes nothing", async () => {
    const { directory } = await twoReleaseProject();
    const before = await readFile(join(directory, "aokit.lock.json"), "utf8");
    const envelope = await runDiffTo(directory, "2026.11.1");
    if (!envelope.ok) throw new Error(envelope.error.message);
    const data = diffCommand.output.parse(envelope.data);
    expect(
      data.files.some((file) => file.path === ".oxlintrc.json" && file.status === "modified"),
    ).toBe(true);
    expect(data.diff).toContain('+  "rules": { "no-debugger": "error" }');
    expect(await readFile(join(directory, "aokit.lock.json"), "utf8")).toBe(before);
  });

  test("before-migrated answers feed the target Render", async () => {
    const { directory } = await twoReleaseProject();
    const envelope = await runDiffTo(directory, "2026.11.1");
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(diffCommand.output.parse(envelope.data).diff).toContain("+# {{name}} (tanstack)");
  });

  test("an older or unknown Release is invalid input", async () => {
    const { directory } = await twoReleaseProject();
    const envelope = await runDiffTo(directory, "2026.10.0");
    expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
});
