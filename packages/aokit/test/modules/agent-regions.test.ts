import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { z } from "zod";
import { cliVersion } from "../../src/cli/version.ts";

const lockfileSchema = z.object({
  files: z.record(z.string(), z.object({ owners: z.array(z.string()) })),
});

const context = { version: cliVersion, env: {}, commands: [] };
const workspace = mkdtempSync(join(tmpdir(), "aokit-agent-regions-"));
let counter = 0;

afterAll(() => rm(workspace, { recursive: true, force: true }));

async function createProject(registryPath: string, modules: string): Promise<string> {
  counter += 1;
  const directory = join(workspace, `app-${counter}`);
  const envelope = await runCommand(createCommand, context, {
    directory,
    modules,
    registry: registryPath,
    yes: true,
    install: false,
    git: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  return directory;
}

function removeModule(directory: string, module: string) {
  return runCommand(removeCommand, context, {
    module,
    directory,
    yes: true,
    install: false,
    allowDirty: true,
  });
}

const registry = join(import.meta.dir, "..", "..", "..", "..", "registry");

const curated = ["oxc", "knip", "vite-react", "tailwind4", "hono", "docker", "coolify"] as const;

const dependentsOf: Record<string, readonly string[]> = {
  oxc: ["knip"],
  "vite-react": ["tailwind4"],
  docker: ["coolify"],
};

const skillPath = ".claude/skills/hono-add-route/SKILL.md";

function without(selection: readonly string[], removed: readonly string[]): string {
  return selection.filter((name) => !removed.includes(name)).join(",");
}

function regionIds(text: string): string[] {
  return [...text.matchAll(/<!-- aokit:begin ([a-z][\w:@./-]*) -->/gu)].map(
    (match) => match[1] ?? "",
  );
}

function regionBody(text: string, id: string): string {
  const begin = `<!-- aokit:begin ${id} -->`;
  const start = text.indexOf(begin);
  const end = text.indexOf(`<!-- aokit:end ${id} -->`);
  return text.slice(start, end);
}

async function exists(directory: string, path: string): Promise<boolean> {
  return Bun.file(join(directory, path)).exists();
}

describe("curated Module Regions", () => {
  test("every curated Module contributes one agents Region after the header, in canonical order", async () => {
    const directory = await createProject(registry, curated.join(","));
    const ids = regionIds(await readFile(join(directory, "AGENTS.md"), "utf8"));
    expect(ids[0]).toBe("aokit:header");
    expect(ids.slice(1).toSorted()).toEqual(curated.map((name) => `${name}:agents`).toSorted());
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("hono and oxc give the header then both Module Regions", async () => {
    const directory = await createProject(registry, "hono,oxc");
    const ids = regionIds(await readFile(join(directory, "AGENTS.md"), "utf8"));
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe("aokit:header");
    expect(ids.slice(1).toSorted()).toEqual(["hono:agents", "oxc:agents"]);
  });

  test("hono ships the Skill with valid frontmatter, and a Project without hono has none", async () => {
    const withHono = await createProject(registry, "hono");
    const skill = await readFile(join(withHono, skillPath), "utf8");
    expect(skill).toMatch(/^---\nname: hono-add-route\ndescription: \S.*\n---\n/u);
    const lockfile = lockfileSchema.parse(
      JSON.parse(await readFile(join(withHono, "aokit.lock.json"), "utf8")),
    );
    expect(lockfile.files[skillPath]?.owners).toContain("hono");
    const withoutHono = await createProject(registry, "docker");
    expect(await exists(withoutHono, skillPath)).toBe(false);
  });

  test("rendering with and without oxc gives byte-identical shared Regions and Skill", async () => {
    const others = ["vite-react", "tailwind4", "hono", "docker", "coolify"];
    const plain = await createProject(registry, others.join(","));
    const formatted = await createProject(registry, ["oxc", ...others].join(","));
    const plainAgents = await readFile(join(plain, "AGENTS.md"), "utf8");
    const formattedAgents = await readFile(join(formatted, "AGENTS.md"), "utf8");
    for (const id of regionIds(plainAgents)) {
      expect(regionBody(formattedAgents, id)).toBe(regionBody(plainAgents, id));
    }
    expect(regionIds(formattedAgents)).toContain("oxc:agents");
    expect(await readFile(join(formatted, "CLAUDE.md"), "utf8")).toBe(
      await readFile(join(plain, "CLAUDE.md"), "utf8"),
    );
    expect(await readFile(join(formatted, skillPath), "utf8")).toBe(
      await readFile(join(plain, skillPath), "utf8"),
    );
  });

  test.each(curated)("remove %s removes exactly its Region (and the hono Skill)", async (name) => {
    const selection = curated.filter((module) => !(dependentsOf[name] ?? []).includes(module));
    const directory = await createProject(registry, selection.join(","));
    const removed = await removeModule(directory, name);
    if (!removed.ok) throw new Error(removed.error.message);
    const fresh = await createProject(registry, without(selection, [name]));
    const pairs = await Promise.all(
      ["AGENTS.md", "CLAUDE.md"].map((path) =>
        Promise.all([readFile(join(directory, path), "utf8"), readFile(join(fresh, path), "utf8")]),
      ),
    );
    for (const [actual, expected] of pairs) expect(actual).toBe(expected);
    expect(regionIds(await readFile(join(directory, "AGENTS.md"), "utf8"))).not.toContain(
      `${name}:agents`,
    );
    if (name === "hono") expect(await exists(directory, skillPath)).toBe(false);
  });
});
