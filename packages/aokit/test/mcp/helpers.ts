import { expect } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { z } from "zod";
import { cliVersion } from "../../src/cli/version.ts";
import { createMcpServer } from "../../src/mcp/server.ts";

/** A client connected in-process to a fresh server, so each test starts a new Plan session. */
export async function connectClient(): Promise<Client> {
  const server = createMcpServer({ context: { version: cliVersion, env: {}, commands: [] } });
  const client = new Client({ name: "aokit-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** A canonical temp directory, so paths compare equal to what the server resolves. */
export function newWorkspace(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), "aokit-mcp-")));
}

/** The explicit `create` input with every field stated. */
export function createInput(
  directory: string,
  modules = "oxc,vite-react",
): Record<string, unknown> {
  return {
    directory,
    layout: "single",
    modules,
    from: null,
    answer: null,
    registry: null,
    trust: null,
  };
}

/** Builds a fixture Registry whose `eslint` Module conflicts with the `lint` Capability of `oxc`. */
export async function conflictingRegistry(workspace: string): Promise<string> {
  const source = await writeRegistrySourceFixture();
  await mkdir(join(source, "eslint"), { recursive: true });
  await writeFile(
    join(source, "eslint", "module.ts"),
    `export default { name: "eslint", version: "1.0.0", provides: ["eslint"], conflicts: ["lint"] };\n`,
  );
  const out = join(workspace, "conflicting-registry");
  await buildRegistry(source, out);
  await rm(source, { recursive: true, force: true });
  return out;
}

/** Builds a fixture Registry with the bundled fixture's files under another Release. */
export async function releasedRegistry(workspace: string, release: string): Promise<string> {
  const source = await writeRegistrySourceFixture();
  const catalog = join(source, "catalog");
  const original = join(catalog, "2026.11.0.json");
  const renamed = join(catalog, `${release}.json`);
  await rename(original, renamed);
  await writeFile(renamed, (await readFile(renamed, "utf8")).replace("2026.11.0", release));
  const out = join(workspace, `registry-${release}`);
  await buildRegistry(source, out);
  await rm(source, { recursive: true, force: true });
  return out;
}

const toolEnvelope = z.object({
  ok: z.boolean(),
  data: z.record(z.string(), z.unknown()).nullable(),
  error: z.object({ code: z.string(), message: z.string(), fix: z.string() }).nullable(),
});

type ToolEnvelope = z.infer<typeof toolEnvelope>;

/** Calls a tool and returns its envelope, checking that text and structured content agree. */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolEnvelope & { isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const structured = toolEnvelope.parse(result.structuredContent);
  const [first] = result.content;
  if (first?.type !== "text") throw new Error("the tool result has no text content");
  expect(toolEnvelope.parse(JSON.parse(first.text))).toEqual(structured);
  return { ...structured, isError: result.isError === true };
}

/** The sorted entries of a directory; none when it does not exist. */
export function entriesOf(directory: string): string[] {
  return existsSync(directory) ? readdirSync(directory).toSorted() : [];
}

/** The number of Plan changes in a tool result's data. */
export function planChangeCount(data: Record<string, unknown> | null): number {
  return z.object({ plan: z.object({ changes: z.array(z.unknown()) }) }).parse(data).plan.changes
    .length;
}
