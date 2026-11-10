import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { listTool } from "../../src/mcp/tools/list.ts";
import { callTool, connectClient, newWorkspace } from "./helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function describedRegistry(): Promise<string> {
  const source = await writeRegistrySourceFixture();
  await rm(join(source, "oxc"), { recursive: true, force: true });
  await rm(join(source, "knip"), { recursive: true, force: true });
  await mkdir(join(source, "described"), { recursive: true });
  await writeFile(
    join(source, "described", "module.ts"),
    `export default { name: "described", version: "1.0.0", description: "A described Module.", provides: ["described-capability"] };\n`,
  );
  const out = join(workspace, "described-registry");
  await buildRegistry(source, out);
  await rm(source, { recursive: true, force: true });
  return out;
}

describe("list tool", () => {
  test("is named list", () => {
    expect(listTool.name).toBe("list");
  });

  test("is read-only and requires every field", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "list");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect([...(tool?.inputSchema.required ?? [])].toSorted()).toEqual(["registry", "trust"]);
  });

  test("returns the 52 Modules of the bundled Registry", async () => {
    const client = await connectClient();
    const result = await callTool(client, "list", { registry: null, trust: null });
    expect(result.ok).toBe(true);
    expect(result.data?.["modules"]).toHaveLength(52);
  });

  test("returns the descriptions of a given Registry", async () => {
    const client = await connectClient();
    const registry = await describedRegistry();
    const result = await callTool(client, "list", { registry, trust: null });
    expect(result.data?.["modules"]).toEqual([
      {
        name: "described",
        version: "1.0.0",
        description: "A described Module.",
        provides: ["described-capability"],
      },
    ]);
  });
});
