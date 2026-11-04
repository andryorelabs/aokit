import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { cleanTemporaryDirectories, commandContext, temporaryDirectory } from "../diff/support.ts";
import {
  type FixtureItem,
  removeShadcnFixtures,
  type ServedShadcnRegistry,
  serveShadcnRegistry,
} from "../registry-shadcn/served-shadcn-registry.ts";

const servers: ServedShadcnRegistry[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await removeShadcnFixtures();
  await cleanTemporaryDirectories();
});

const buttonPath = "src/components/ui/button.tsx";
const originalButton =
  'import { cn } from "@lib/utils";\n\nexport function Button() {\n  return <button className={cn("fixture-button")} />;\n}\n';

function buttonItem(content: string): FixtureItem {
  return {
    name: "button",
    type: "registry:ui",
    dependencies: ["clsx@^2.1.0"],
    files: [{ path: "ui/button.tsx", type: "registry:ui", content }],
  };
}

async function gitIn(directory: string, ...args: string[]): Promise<string> {
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
  const [out] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return out;
}

const run = (args: Record<string, unknown>) => runCommand(updateCommand, commandContext, args);
const read = (directory: string, path: string) => readFile(join(directory, path), "utf8");

async function project(): Promise<{ directory: string; served: ServedShadcnRegistry }> {
  const served = await serveShadcnRegistry();
  servers.push(served);
  const directory = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, commandContext, {
    directory,
    modules: "@fixture/button",
    registry: served.url,
    trust: [served.url],
    yes: true,
    install: false,
  });
  if (!created.ok) throw new Error(created.error.message);
  await gitIn(directory, "init", "-q");
  await gitIn(directory, "add", "-A");
  await gitIn(directory, "commit", "-q", "-m", "init");
  return { directory, served };
}

/** A Project created with native Modules, then given `@fixture/button` by `add`. */
async function mixedProject(): Promise<{ directory: string; served: ServedShadcnRegistry }> {
  const served = await serveShadcnRegistry();
  servers.push(served);
  const directory = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, commandContext, {
    directory,
    modules: "oxc,vite-react",
    yes: true,
    install: false,
  });
  if (!created.ok) throw new Error(created.error.message);
  const added = await runCommand(addCommand, commandContext, {
    directory,
    modules: ["@fixture/button"],
    registry: served.url,
    trust: [served.url],
    yes: true,
    install: false,
    allowDirty: true,
  });
  if (!added.ok) throw new Error(added.error.message);
  await gitIn(directory, "init", "-q");
  await gitIn(directory, "add", "-A");
  await gitIn(directory, "commit", "-q", "-m", "init");
  return { directory, served };
}

async function lockedVersion(directory: string): Promise<string> {
  const lockfile = JSON.parse(await read(directory, "aokit.lock.json"));
  return lockfile.modules["@fixture/button"].version;
}

const changedButton = `${originalButton}\nexport const upstreamAddition = true;\n`;

describe("update for Adapted Modules", () => {
  test("--plan lists the changed item with old and new versions and --apply keeps a user edit", async () => {
    const { directory, served } = await project();
    const oldVersion = await lockedVersion(directory);
    const edited = `// my note\n${originalButton}`;
    await writeFile(join(directory, buttonPath), edited);
    await gitIn(directory, "commit", "-aq", "-m", "edit");
    await served.writeItem(buttonItem(changedButton));

    const planned = await run({ directory, plan: true, install: false });
    if (!planned.ok) throw new Error(planned.error.message);
    const data = updateCommand.output.parse(planned.data);
    expect(data.upToDate).toBe(false);
    expect(data.applied).toBe(false);
    expect(data.plan.changes.map((change) => change.path)).toContain(buttonPath);
    expect(await read(directory, buttonPath)).toBe(edited);
    expect(await lockedVersion(directory)).toBe(oldVersion);
    const saved = JSON.parse(await read(join(directory, ".git"), "aokit/plan.json"));
    const newVersion: string = saved.targetLockfile.modules["@fixture/button"].version;
    expect(newVersion).toMatch(/^0\.0\.0-shadcn\.[0-9a-f]{12}$/);
    expect(newVersion).not.toBe(oldVersion);

    const applied = await run({ directory, apply: true, yes: true, install: false });
    if (!applied.ok) throw new Error(applied.error.message);
    const merged = await read(directory, buttonPath);
    expect(merged).toContain("// my note");
    expect(merged).toContain("upstreamAddition");
    expect(await lockedVersion(directory)).toBe(newVersion);
  });

  test("--apply writes the reviewed Plan even when the item changes again afterwards", async () => {
    const { directory, served } = await project();
    await served.writeItem(buttonItem(changedButton));
    const planned = await run({ directory, plan: true, install: false });
    if (!planned.ok) throw new Error(planned.error.message);
    const saved = JSON.parse(await read(join(directory, ".git"), "aokit/plan.json"));
    const reviewed: string = saved.targetLockfile.modules["@fixture/button"].version;
    await served.writeItem(buttonItem(`${changedButton}export const later = 1;\n`));
    const applied = await run({ directory, apply: true, yes: true, install: false });
    if (!applied.ok) throw new Error(applied.error.message);
    expect(await lockedVersion(directory)).toBe(reviewed);
    expect(await read(directory, buttonPath)).not.toContain("later");
  });

  test("an unchanged item yields an empty update", async () => {
    const { directory } = await project();
    const planned = await run({ directory, plan: true, install: false });
    if (!planned.ok) throw new Error(planned.error.message);
    const data = updateCommand.output.parse(planned.data);
    expect(data.upToDate).toBe(true);
    expect(data.plan.changes).toEqual([]);
    const applied = await run({ directory, yes: true, install: false });
    if (!applied.ok) throw new Error(applied.error.message);
    expect(updateCommand.output.parse(applied.data).upToDate).toBe(true);
  });

  test("in a Project of native Modules, an added item's upstream change is an update", async () => {
    const { directory, served } = await mixedProject();
    const nativeVersion = JSON.parse(await read(directory, "aokit.lock.json")).modules["oxc"]
      .version;
    const oldVersion = await lockedVersion(directory);
    const edited = `// my note\n${originalButton}`;
    await writeFile(join(directory, buttonPath), edited);
    await gitIn(directory, "commit", "-aq", "-m", "edit");
    await served.writeItem(buttonItem(changedButton));

    const planned = await run({ directory, plan: true, install: false });
    if (!planned.ok) throw new Error(planned.error.message);
    const data = updateCommand.output.parse(planned.data);
    expect(data.upToDate).toBe(false);
    expect(data.plan.changes.map((change) => change.path)).toContain(buttonPath);
    const saved = JSON.parse(await read(join(directory, ".git"), "aokit/plan.json"));
    const newVersion: string = saved.targetLockfile.modules["@fixture/button"].version;
    expect(newVersion).toMatch(/^0\.0\.0-shadcn\.[0-9a-f]{12}$/);
    expect(newVersion).not.toBe(oldVersion);

    const applied = await run({ directory, apply: true, yes: true, install: false });
    if (!applied.ok) throw new Error(applied.error.message);
    const merged = await read(directory, buttonPath);
    expect(merged).toContain("// my note");
    expect(merged).toContain("upstreamAddition");
    const lockfile = JSON.parse(await read(directory, "aokit.lock.json"));
    expect(lockfile.modules["@fixture/button"].version).toBe(newVersion);
    expect(lockfile.modules["oxc"].version).toBe(nativeVersion);
  });

  test("in a Project of native Modules, an unchanged added item yields no update", async () => {
    const { directory } = await mixedProject();
    const planned = await run({ directory, plan: true, install: false });
    if (!planned.ok) throw new Error(planned.error.message);
    expect(updateCommand.output.parse(planned.data).upToDate).toBe(true);
  });

  test("--abort after a plan restores the pre-update state", async () => {
    const { directory, served } = await project();
    const before = await read(directory, "aokit.lock.json");
    await served.writeItem(buttonItem(changedButton));
    const planned = await run({ directory, plan: true, install: false });
    if (!planned.ok) throw new Error(planned.error.message);
    const aborted = await run({ directory, abort: true });
    if (!aborted.ok) throw new Error(aborted.error.message);
    expect(await read(directory, "aokit.lock.json")).toBe(before);
    expect(await read(directory, buttonPath)).toBe(await read(directory, buttonPath));
    expect(await gitIn(directory, "status", "--porcelain")).toBe("");
    const reapplied = await run({ directory, apply: true, yes: true, install: false });
    expect(reapplied.ok).toBe(false);
  });

  test("a conflicting edit is aborted back to the pre-update tree", async () => {
    const { directory, served } = await project();
    const lockfile = await read(directory, "aokit.lock.json");
    const conflicting = originalButton.replace("fixture-button", "mine");
    await writeFile(join(directory, buttonPath), conflicting);
    await gitIn(directory, "commit", "-aq", "-m", "edit");
    await served.writeItem(buttonItem(originalButton.replace("fixture-button", "theirs")));
    const applied = await run({ directory, yes: true, install: false });
    expect(applied.ok).toBe(false);
    const aborted = await run({ directory, abort: true });
    if (!aborted.ok) throw new Error(aborted.error.message);
    expect(await read(directory, buttonPath)).toBe(conflicting);
    expect(await read(directory, "aokit.lock.json")).toBe(lockfile);
  });
});
