import { expect } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { createMcpServer } from "../../src/mcp/server.ts";

/** A client connected in-process to a fresh server whose user config and cache live in `home`. */
export async function connectClient(home: string): Promise<Client> {
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
  };
  const server = createMcpServer({ context: { version: cliVersion, env, commands: [] } });
  const client = new Client({ name: "aokit-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** A canonical temp directory, so paths compare equal to what the server resolves. */
export function newWorkspace(): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), "aokit-mcp-add-")));
}

/** Runs git in a directory with a fixed identity and no signing. */
export async function git(directory: string, ...args: string[]): Promise<void> {
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
    { cwd: directory, stdout: "ignore", stderr: "ignore" },
  );
  expect(await child.exited).toBe(0);
}

/** Creates a Project from the bundled Registry and commits it, so `add` sees a clean tree. */
export async function committedProject(directory: string): Promise<void> {
  const envelope = await runCommand(
    createCommand,
    { version: cliVersion, env: {}, commands: [] },
    { directory, layout: "single", modules: "oxc,vite-react", yes: true, install: false },
  );
  expect(envelope.ok).toBe(true);
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-q", "-m", "init");
}

/** The explicit `add` input with every field stated. */
export function addInput(
  directory: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    modules: ["knip"],
    directory,
    answer: null,
    registry: null,
    trust: null,
    ...overrides,
  };
}
