import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Client,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResponse,
  type JSONRPCMessage,
  type Transport,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import { aokitCommand } from "../helpers/aokit-process.ts";

const workspace = realpathSync(mkdtempSync(join(tmpdir(), "aokit-mcp-stdio-")));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** The JSON-RPC message a parsed stdout line holds; throws when the line is anything else. */
function toJsonRpcMessage(value: unknown): JSONRPCMessage {
  if (isJSONRPCRequest(value) || isJSONRPCNotification(value) || isJSONRPCResponse(value)) {
    return value;
  }
  throw new Error(`not a JSON-RPC message: ${JSON.stringify(value)}`);
}

/** A stdio client transport over a spawned `aokit mcp` that keeps every raw stdout line. */
class RecordingTransport implements Transport {
  readonly lines: string[] = [];
  readonly process = Bun.spawn([...aokitCommand(), "mcp"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  start(): Promise<void> {
    this.read().catch((error: unknown) => {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    });
    return Promise.resolve();
  }

  private async read(): Promise<void> {
    const decoder = new TextDecoder();
    let buffered = "";
    for await (const chunk of this.process.stdout) {
      buffered += decoder.decode(chunk, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        this.lines.push(line);
        this.onmessage?.(toJsonRpcMessage(JSON.parse(line)));
        newline = buffered.indexOf("\n");
      }
    }
    if (buffered !== "") this.lines.push(buffered);
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await this.process.stdin.write(`${JSON.stringify(message)}\n`);
    await this.process.stdin.flush();
  }

  async close(): Promise<void> {
    await this.process.stdin.end();
  }
}

function expectOnlyJsonRpc(lines: readonly string[]): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(() => toJsonRpcMessage(JSON.parse(line))).not.toThrow();
  }
}

function createInput(directory: string): Record<string, unknown> {
  return {
    directory,
    layout: "single",
    modules: "oxc,vite-react",
    from: null,
    answer: null,
    registry: null,
    trust: null,
  };
}

test("plan then create over stdio writes only JSON-RPC frames to stdout and exits 0", async () => {
  const transport = new RecordingTransport();
  const client = new Client({ name: "aokit-stdio-test", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const toolNames = tools.map((tool) => tool.name);
  expect(toolNames).toContain("plan");
  expect(toolNames).toContain("create");
  const directory = join(workspace, "app");
  const planned = await client.callTool({ name: "plan", arguments: createInput(directory) });
  const planData = z
    .object({ data: z.object({ planId: z.string() }) })
    .parse(planned.structuredContent).data;
  const created = await client.callTool({
    name: "create",
    arguments: { ...createInput(directory), planId: planData.planId },
  });
  expect(created.isError).toBe(false);
  expect(readdirSync(directory)).toContain("aokit.lock.json");
  await transport.close();
  expect(await transport.process.exited).toBe(0);
  expectOnlyJsonRpc(transport.lines);
}, 60_000);

test("closing stdin while a call runs exits 0 with only JSON-RPC frames on stdout", async () => {
  const transport = new RecordingTransport();
  const client = new Client({ name: "aokit-stdio-test", version: "1.0.0" });
  await client.connect(transport);
  const pending = client
    .callTool({ name: "plan", arguments: createInput(join(workspace, "mid-call")) })
    .catch(() => undefined);
  await transport.close();
  expect(await transport.process.exited).toBe(0);
  await Promise.race([pending, Bun.sleep(100)]);
  expectOnlyJsonRpc(transport.lines);
  expect(readdirSync(workspace)).not.toContain("mid-call");
}, 60_000);

test("closing stdin while create runs leaves a complete Project or none", async () => {
  const transport = new RecordingTransport();
  const client = new Client({ name: "aokit-stdio-test", version: "1.0.0" });
  await client.connect(transport);
  const directory = join(workspace, "mid-create");
  const planned = await client.callTool({ name: "plan", arguments: createInput(directory) });
  const planData = z
    .object({ data: z.object({ planId: z.string() }) })
    .parse(planned.structuredContent).data;
  const pending = client
    .callTool({
      name: "create",
      arguments: { ...createInput(directory), planId: planData.planId },
    })
    .catch(() => undefined);
  await transport.close();
  expect(await transport.process.exited).toBe(0);
  await Promise.race([pending, Bun.sleep(100)]);
  expectOnlyJsonRpc(transport.lines);
  const entries = existsSync(directory) ? readdirSync(directory) : [];
  if (entries.length > 0) expect(entries).toContain("aokit.lock.json");
}, 60_000);
