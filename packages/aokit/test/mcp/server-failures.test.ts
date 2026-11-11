import { afterAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { callTool, connectClient, createInput, newWorkspace } from "./helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test("a tool that throws on a NUL byte in its directory becomes an error envelope and the next call still runs", async () => {
  const client = await connectClient();

  const failed = await callTool(client, "plan", createInput(join(workspace, "bad\0dir")));
  const next = await callTool(client, "list", {});

  expect(failed.ok).toBe(false);
  expect(failed.isError).toBe(true);
  expect(next.error?.code).toBe("INVALID_INPUT");
});
