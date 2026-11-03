import { afterEach, describe, expect, test } from "bun:test";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { cleanTemporaryDirectories, commandContext, temporaryDirectory } from "../diff/support.ts";

afterEach(cleanTemporaryDirectories);

const committedRegistry = join(import.meta.dir, "../../../../registry");

interface IndexModule {
  latest: string;
  versions: Record<string, unknown>;
}

interface IndexShape {
  release: string;
  releases: Record<string, unknown>;
  modules: Record<string, IndexModule>;
}

async function git(directory: string, ...args: string[]): Promise<void> {
  const child = Bun.spawn(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  await child.exited;
}

function atFirstRelease(index: IndexShape): IndexShape {
  const copy = structuredClone(index);
  copy.release = "2026.11.0";
  delete copy.releases["2026.11.1"];
  for (const [name, previous] of [
    ["vite-react", "1.0.0"],
    ["oxc", "1.0.0"],
  ] as const) {
    const entry = copy.modules[name];
    if (entry === undefined) throw new Error(`index lists no ${name}`);
    entry.latest = previous;
    for (const version of Object.keys(entry.versions)) {
      if (version !== previous) delete entry.versions[version];
    }
  }
  return copy;
}

describe("aokit update against the committed Registry", () => {
  test("moves an edited routes.tsx to router.tsx and rewrites user imports", async () => {
    const registry = join(await temporaryDirectory(), "registry");
    await cp(committedRegistry, registry, { recursive: true });
    const indexPath = join(registry, "index.json");
    const fullIndexText = await readFile(indexPath, "utf8");
    const full: IndexShape = JSON.parse(fullIndexText);
    await writeFile(indexPath, `${JSON.stringify(atFirstRelease(full), null, 2)}\n`, "utf8");
    const directory = join(await temporaryDirectory(), "app");
    const created = await runCommand(createCommand, commandContext, {
      directory,
      modules: "vite-react",
      registry,
      yes: true,
      install: false,
    });
    if (!created.ok) throw new Error(created.error.message);
    const routesPath = join(directory, "src/routes.tsx");
    const original = await readFile(routesPath, "utf8");
    await writeFile(routesPath, `${original}\nexport const userRoute = "mine";\n`, "utf8");
    await writeFile(join(directory, "src/user.ts"), `import { userRoute } from "./routes";\n`);
    await git(directory, "init", "-q");
    await git(directory, "add", "-A");
    await git(directory, "commit", "-q", "-m", "init");
    await writeFile(indexPath, fullIndexText, "utf8");
    const envelope = await runCommand(updateCommand, commandContext, {
      directory,
      registry,
      yes: true,
      install: false,
    });
    if (!envelope.ok) throw new Error(envelope.error.message);
    const router = await readFile(join(directory, "src/router.tsx"), "utf8");
    expect(router).toContain(`export const userRoute = "mine";`);
    expect(await Bun.file(routesPath).exists()).toBe(false);
    expect(await readFile(join(directory, "src/user.ts"), "utf8")).toBe(
      `import { userRoute } from "./router";\n`,
    );
    const lockfile = JSON.parse(await readFile(join(directory, "aokit.lock.json"), "utf8"));
    expect(lockfile.modules["vite-react"].version).toBe("1.1.0");
  });
});
