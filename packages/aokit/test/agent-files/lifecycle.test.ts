import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runCommand } from "../../src/cli/command.ts";
import { diffCommand } from "../../src/cli/commands/diff.ts";
import { ejectCommand } from "../../src/cli/commands/eject.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { restoreCommand } from "../../src/cli/commands/restore.ts";
import {
  addModule,
  agentsRegistry,
  cleanWorkspace,
  context,
  createProject,
  driftStateOf,
  readText,
  regionIds,
  removeModule,
  tree,
  updateProject,
  writeText,
} from "./support.ts";

let registry = "";

beforeAll(async () => {
  registry = await agentsRegistry();
});

afterAll(cleanWorkspace);

const notes = "\n## My notes\n\nkeep me\nexactly\n";
const oxcEnd = "<!-- aokit:end oxc:agents -->";

async function withNotes(directory: string): Promise<string> {
  const original = await readText(directory, "AGENTS.md");
  await writeText(directory, "AGENTS.md", `${original}${notes}`);
  return original;
}

describe("Agent files lifecycle", () => {
  test("create, add and remove leave one Region per Module and equal a fresh Render", async () => {
    const lifecycle = await createProject(registry, "oxc");
    expect((await addModule(lifecycle, "knip")).ok).toBe(true);
    expect(regionIds(await readText(lifecycle, "AGENTS.md"))).toEqual([
      "aokit:header",
      "oxc:agents",
      "knip:agents",
    ]);
    expect((await removeModule(lifecycle, "knip")).ok).toBe(true);
    const fresh = await createProject(registry, "oxc");
    expect(await tree(lifecycle)).toEqual(await tree(fresh));
  });

  test("a note at the end survives add, remove and update byte for byte", async () => {
    const directory = await createProject(registry, "oxc");
    await withNotes(directory);
    expect(await driftStateOf(directory, "AGENTS.md")).toBe("pristine");
    expect((await addModule(directory, "knip")).ok).toBe(true);
    const afterAdd = await readText(directory, "AGENTS.md");
    expect(afterAdd.endsWith(notes)).toBe(true);
    expect(regionIds(afterAdd)).toContain("knip:agents");
    expect(await driftStateOf(directory, "AGENTS.md")).toBe("pristine");
    expect((await updateProject(directory)).ok).toBe(true);
    expect((await readText(directory, "AGENTS.md")).endsWith(notes)).toBe(true);
    expect((await removeModule(directory, "knip")).ok).toBe(true);
    const afterRemove = await readText(directory, "AGENTS.md");
    expect(afterRemove.endsWith(notes)).toBe(true);
    expect(regionIds(afterRemove)).toEqual(["aokit:header", "oxc:agents"]);
    expect(await driftStateOf(directory, "AGENTS.md")).toBe("pristine");
  });

  test("an edit inside a Region is modified and merged inside that Region only", async () => {
    const directory = await createProject(registry, "oxc");
    const original = await withNotes(directory);
    const edited = `${original.replace(oxcEnd, `my extra line\n${oxcEnd}`)}${notes}`;
    await writeText(directory, "AGENTS.md", edited);
    expect(await driftStateOf(directory, "AGENTS.md")).toBe("modified");
    await addModule(directory, "knip");
    const merged = await readText(directory, "AGENTS.md");
    expect(merged).toContain("my extra line");
    expect(merged.endsWith(notes)).toBe(true);
    expect(regionIds(merged)).toEqual(["aokit:header", "oxc:agents", "knip:agents"]);
  });

  test("a hand-written AGENTS.md is adopted", async () => {
    const directory = await createProject(registry, "oxc");
    await writeText(directory, "AGENTS.md", "# Mine\n\nhand written\n");
    const envelope = await addModule(directory, "knip");
    expect(envelope.ok).toBe(true);
    const adopted = await readText(directory, "AGENTS.md");
    expect(adopted.startsWith("<!-- aokit:begin aokit:header -->")).toBe(true);
    expect(adopted).toContain("# Mine\n\nhand written\n");
    expect(regionIds(adopted)).toEqual(["aokit:header", "oxc:agents", "knip:agents"]);
  });

  test("removing every removable Module leaves the header and CLAUDE.md", async () => {
    const directory = await createProject(registry, "oxc,knip");
    await removeModule(directory, "knip");
    expect((await removeModule(directory, "oxc")).ok).toBe(true);
    expect(regionIds(await readText(directory, "AGENTS.md"))).toEqual(["aokit:header"]);
    expect(await readText(directory, "CLAUDE.md")).toContain("@AGENTS.md");
  });

  test("restore after an in-Region edit restores the Region and keeps the notes", async () => {
    const directory = await createProject(registry, "oxc");
    const original = await readText(directory, "AGENTS.md");
    const edited = original.replace(oxcEnd, `junk\n${oxcEnd}`);
    await writeText(directory, "AGENTS.md", `${edited}${notes}`);
    const envelope = await runCommand(restoreCommand, context, {
      path: "AGENTS.md",
      directory,
      yes: true,
      allowDirty: true,
    });
    expect(envelope.ok).toBe(true);
    expect(await readText(directory, "AGENTS.md")).toBe(`${original}${notes}`);
    expect(await driftStateOf(directory, "AGENTS.md")).toBe("pristine");
  });

  test("restore re-inserts a hand-deleted Region in Render order", async () => {
    const directory = await createProject(registry, "oxc,knip");
    const original = await readText(directory, "AGENTS.md");
    const withoutOxc = original.replace(
      /<!-- aokit:begin oxc:agents -->[\s\S]*?<!-- aokit:end oxc:agents -->\n\n/,
      "",
    );
    expect(regionIds(withoutOxc)).toEqual(["aokit:header", "knip:agents"]);
    await writeText(directory, "AGENTS.md", `${withoutOxc}${notes}`);
    const envelope = await runCommand(restoreCommand, context, {
      path: "AGENTS.md",
      directory,
      yes: true,
      allowDirty: true,
    });
    expect(envelope.ok).toBe(true);
    expect(await readText(directory, "AGENTS.md")).toBe(`${original}${notes}`);
    expect(await driftStateOf(directory, "AGENTS.md")).toBe("pristine");
  });

  test("restore reports malformed markers instead of crashing", async () => {
    const directory = await createProject(registry, "oxc");
    const original = await readText(directory, "AGENTS.md");
    await writeText(directory, "AGENTS.md", original.replace(oxcEnd, ""));
    const envelope = await runCommand(restoreCommand, context, {
      path: "AGENTS.md",
      directory,
      yes: true,
      allowDirty: true,
    });
    expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  test("diff does not report Windows line endings around pristine Regions", async () => {
    const directory = await createProject(registry, "oxc");
    const original = await readText(directory, "AGENTS.md");
    await writeText(directory, "AGENTS.md", `${original}${notes}`.replaceAll("\n", "\r\n"));
    const clean = await runCommand(diffCommand, context, { directory });
    expect(clean).toMatchObject({ ok: true, data: { files: [], diff: "" } });
  });

  test("add pulls in a required Module with one Region each", async () => {
    const directory = await createProject(registry, "docker");
    const added = await addModule(directory, "knip");
    if (!added.ok) throw new Error(added.error.message);
    expect(regionIds(await readText(directory, "AGENTS.md")).toSorted()).toEqual(
      ["aokit:header", "docker:agents", "knip:agents", "oxc:agents"].toSorted(),
    );
    expect(regionIds(await readText(directory, "AGENTS.md"))).toHaveLength(4);
    expect(await driftStateOf(directory, "AGENTS.md")).toBe("pristine");
  });

  test("a cascaded remove drops the Regions of every dependent Module at once", async () => {
    const directory = await createProject(registry, "oxc,knip");
    expect(regionIds(await readText(directory, "AGENTS.md"))).toEqual([
      "aokit:header",
      "oxc:agents",
      "knip:agents",
    ]);
    const removed = await runCommand(removeCommand, context, {
      module: "oxc",
      directory,
      yes: true,
      install: false,
      allowDirty: true,
      cascade: true,
    });
    if (!removed.ok) throw new Error(removed.error.message);
    expect(regionIds(await readText(directory, "AGENTS.md"))).toEqual(["aokit:header"]);
    expect(await driftStateOf(directory, "AGENTS.md")).toBe("pristine");
  });

  test("diff ignores notes outside markers and shows an in-Region edit", async () => {
    const directory = await createProject(registry, "oxc");
    const original = await withNotes(directory);
    const clean = await runCommand(diffCommand, context, { directory });
    expect(clean).toMatchObject({ ok: true, data: { files: [], diff: "" } });
    await writeText(
      directory,
      "AGENTS.md",
      `${original.replace(oxcEnd, `junk\n${oxcEnd}`)}${notes}`,
    );
    const changed = await runCommand(diffCommand, context, { directory });
    if (!changed.ok) throw new Error(changed.error.message);
    const output = JSON.stringify(changed.data);
    expect(output).toContain("junk");
    expect(output).not.toContain("keep me");
  });

  test("an ejected AGENTS.md is never touched by add, remove or update", async () => {
    const directory = await createProject(registry, "oxc");
    const ejected = await runCommand(ejectCommand, context, { path: "AGENTS.md", directory });
    expect(ejected.ok).toBe(true);
    await withNotes(directory);
    const content = await readText(directory, "AGENTS.md");
    await addModule(directory, "knip");
    expect(await readText(directory, "AGENTS.md")).toBe(content);
    await removeModule(directory, "knip");
    expect(await readText(directory, "AGENTS.md")).toBe(content);
    await updateProject(directory);
    expect(await readText(directory, "AGENTS.md")).toBe(content);
  });
});
