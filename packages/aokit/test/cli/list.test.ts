import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { runCli, type CliIo } from "../../src/cli/adapter.ts";
import { groupByCapability, listModules } from "../../src/cli/commands/list.ts";
import { openRegistry } from "../../src/registry/index.ts";
import { exposedCommands, hiddenCommands } from "../../src/cli/commands/registry.ts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { z } from "zod";
import { parseJson } from "../helpers/cli-json.ts";
import { newWorkspace } from "../mcp/helpers.ts";

const listEnvelope = z.object({
  ok: z.boolean(),
  data: z.object({
    modules: z.array(
      z.object({
        name: z.string(),
        version: z.string(),
        description: z.string(),
        provides: z.array(z.string()),
      }),
    ),
  }),
});

const workspace = newWorkspace();

async function describedRegistry(root: string): Promise<string> {
  const source = await writeRegistrySourceFixture();
  await rm(join(source, "oxc"), { recursive: true, force: true });
  await rm(join(source, "knip"), { recursive: true, force: true });
  await mkdir(join(source, "described"), { recursive: true });
  await writeFile(
    join(source, "described", "module.ts"),
    `export default { name: "described", version: "1.0.0", description: "A described Module.", provides: ["described-capability"] };\n`,
  );
  const out = join(root, "described-registry");
  await buildRegistry(source, out);
  await rm(source, { recursive: true, force: true });
  return out;
}

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const registryPromise = describedRegistry(workspace);

async function runAokit(argv: string[]): Promise<{ exitCode: number; stdout: string }> {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    isTTY: false,
  };
  const exitCode = await runCli({
    argv,
    commands: exposedCommands,
    hiddenCommands,
    env: {},
    version: "9.9.9",
    io,
  });
  return { exitCode, stdout };
}

describe("aokit list", () => {
  test("--json returns every Module of the bundled Registry", async () => {
    const result = await runAokit(["list", "--json"]);
    expect(result.exitCode).toBe(0);
    const envelope = listEnvelope.parse(parseJson(result.stdout));
    expect(envelope.ok).toBe(true);
    expect(envelope.data.modules).toHaveLength(52);
    for (const entry of envelope.data.modules) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  test("honors --registry and returns each description", async () => {
    const registry = await registryPromise;
    const result = await runAokit(["list", "--json", "--registry", registry]);
    expect(result.exitCode).toBe(0);
    const { modules } = listEnvelope.parse(parseJson(result.stdout)).data;
    expect(modules).toEqual([
      {
        name: "described",
        version: "1.0.0",
        description: "A described Module.",
        provides: ["described-capability"],
      },
    ]);
  });

  test("prints the Modules grouped by Capability without --json", async () => {
    const registry = await registryPromise;
    const result = await runAokit(["list", "--registry", registry]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(
      "described-capability\n  described@1.0.0  A described Module.",
    );
  });

  test("listModules reads the latest version of every Module of an opened Registry", async () => {
    const registry = await openRegistry(
      { kind: "local", path: await registryPromise },
      { cliVersion: "9.9.9" },
    );
    expect(await listModules(registry)).toEqual([
      {
        name: "described",
        version: "1.0.0",
        description: "A described Module.",
        provides: ["described-capability"],
      },
    ]);
  });

  test("lists a Release without a description with an empty description", async () => {
    const registry = await openRegistry(
      { kind: "local", path: join(import.meta.dir, "..", "..", "..", "..", "registry") },
      { cliVersion: "9.9.9" },
    );
    const modules = await listModules(registry);
    expect(modules.find((entry) => entry.name === "adr-docs")?.description).toBe("");
    for (const entry of modules) {
      expect(entry.description).not.toContain("No description published");
    }
  });

  test("is listed by aokit schema", async () => {
    const result = await runAokit(["schema"]);
    expect(result.stdout).toContain('"list"');
  });

  test("groupByCapability files a Module under each Capability and an unprovided one apart", () => {
    const groups = groupByCapability([
      { name: "b", version: "1.0.0", description: "B", provides: ["x", "y"] },
      { name: "a", version: "1.0.0", description: "A", provides: [] },
    ]);
    expect(Object.keys(groups)).toEqual(["uncategorized", "x", "y"]);
    expect(groups["x"]?.map((entry) => entry.name)).toEqual(["b"]);
  });
});
