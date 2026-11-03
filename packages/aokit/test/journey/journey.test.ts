import { afterAll, expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { diffCommand } from "../../src/cli/commands/diff.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { restoreCommand } from "../../src/cli/commands/restore.ts";
import { exitCodeForEnvelope } from "../../src/cli/envelope.ts";
import { commitAll, context, git, newWorkspace } from "../restore/helpers.ts";

const workspace = newWorkspace();
const editedPath = "src/main.tsx";

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function tree(root: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(join(root, prefix)).toSorted()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (name === ".git") continue;
    if (statSync(join(root, relative)).isDirectory()) Object.assign(files, tree(root, relative));
    else files[relative] = readFileSync(join(root, relative), "utf8");
  }
  return files;
}

async function commitEverything(directory: string, message: string): Promise<void> {
  await git(directory, "add", "-A");
  await git(directory, "commit", "-q", "-m", message);
}

test("create, add, doctor, edit, diff, restore and remove leave the tree of a fresh create", async () => {
  const directory = join(workspace, "journey");
  const created = await runCommand(createCommand, context, {
    directory,
    modules: "oxc,vite-react",
    yes: true,
    install: false,
  });
  expect(exitCodeForEnvelope(created)).toBe(0);
  await commitAll(directory);

  const added = await runCommand(addCommand, context, {
    modules: ["knip"],
    directory,
    yes: true,
    install: false,
  });
  expect(exitCodeForEnvelope(added)).toBe(0);
  await commitEverything(directory, "add knip");

  const healthy = await runCommand(doctorCommand, context, { directory });
  expect(exitCodeForEnvelope(healthy)).toBe(0);

  await appendFile(join(directory, editedPath), "// edited\n");
  const drifted = await runCommand(doctorCommand, context, { directory });
  expect(exitCodeForEnvelope(drifted)).toBe(1);
  expect(drifted).toMatchObject({ ok: false, error: { code: "DRIFT" } });

  const diffed = await runCommand(diffCommand, context, { directory });
  expect(exitCodeForEnvelope(diffed)).toBe(0);
  expect(diffed).toMatchObject({
    ok: true,
    data: { files: [{ path: editedPath, status: "modified" }] },
  });
  if (diffed.ok) expect(diffCommand.output.parse(diffed.data).diff).toContain("// edited");

  const restored = await runCommand(restoreCommand, context, {
    path: editedPath,
    directory,
    yes: true,
    allowDirty: true,
  });
  expect(exitCodeForEnvelope(restored)).toBe(0);
  expect(await readFile(join(directory, editedPath), "utf8")).not.toContain("// edited");

  const removed = await runCommand(removeCommand, context, {
    module: "knip",
    directory,
    yes: true,
    install: false,
  });
  expect(exitCodeForEnvelope(removed)).toBe(0);

  const fresh = join(workspace, "fresh");
  const recreated = await runCommand(createCommand, context, {
    directory: fresh,
    modules: "oxc,vite-react",
    yes: true,
    install: false,
  });
  expect(exitCodeForEnvelope(recreated)).toBe(0);
  expect(tree(directory)).toEqual(tree(fresh));
});
