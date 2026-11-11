import { afterAll, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { layoutMigrateCommand } from "../../src/cli/commands/layout-migrate.ts";
import { commitAll, context, newWorkspace } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

let counter = 0;

async function singleProject(modules: string): Promise<string> {
  counter += 1;
  const directory = join(workspace, `app-${counter}`);
  const created = await runCommand(createCommand, context, {
    directory,
    layout: "single",
    modules,
    yes: true,
    install: false,
    git: false,
  });
  expect(created.ok).toBe(true);
  return directory;
}

test("--yes applies a migration with a changing Plan without asking", async () => {
  const directory = await singleProject("oxc");
  await commitAll(directory);
  const envelope = await runCommand(layoutMigrateCommand, context, {
    directory,
    layout: "monorepo",
    yes: true,
  });
  expect(envelope.ok && envelope.data).toMatchObject({ changed: true, applied: true });
});

test("--dry-run lists the Conflicts a migration would hit and writes nothing", async () => {
  const directory = await singleProject("oxc,vite-react,hono,knip");
  await mkdir(join(directory, "apps/web"), { recursive: true });
  await writeFile(join(directory, "apps/web/tsconfig.json"), "user owned\n");
  await commitAll(directory);
  const envelope = await runCommand(layoutMigrateCommand, context, {
    directory,
    layout: "monorepo",
    yes: false,
    dryRun: true,
  });
  expect(envelope.ok && envelope.data).toMatchObject({ applied: false, changed: true });
});
