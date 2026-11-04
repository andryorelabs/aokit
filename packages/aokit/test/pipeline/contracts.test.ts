import { expect, test } from "bun:test";
import { Vfs } from "../../src/engine/index.ts";
import { buildProject } from "../../src/pipeline/index.ts";
import { input } from "./fixtures.ts";

test("a non-empty base without the previous Lockfile throws and is a type error", async () => {
  const base = Vfs.empty();
  base.write("user.txt", "mine");
  const attempt = async (): Promise<unknown> =>
    // @ts-expect-error a base requires `previous`
    buildProject({ ...input(), base });
  const failed = await attempt().then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failed).toBeInstanceOf(TypeError);
  expect(String(failed)).toContain("previous");
});

test("only the Agent files carry the aokit owner, and Modules record selected and integrity", async () => {
  const built = await buildProject(input({ layout: "monorepo" }));
  if (!built.ok) throw new Error(built.error.message);
  const aokitFiles = Object.entries(built.lockfile.files)
    .filter(([, entry]) => entry.owners.includes("aokit"))
    .map(([path]) => path);
  expect(aokitFiles).toEqual(["AGENTS.md", "CLAUDE.md"]);
  expect(Object.values(built.lockfile.deps).flatMap((entry) => entry.owners)).not.toContain(
    "aokit",
  );
  expect(built.lockfile.modules["auth"]?.selected).toBe(true);
  expect(built.lockfile.modules["base"]?.selected).toBe(false);
  expect(built.lockfile.modules["base"]?.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
});
