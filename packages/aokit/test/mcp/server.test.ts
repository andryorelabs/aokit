import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { startMcpServer } from "../../src/mcp/server.ts";
import { addInput, connectClient as connectAddClient } from "../mcp-add/helpers.ts";
import { callTool, connectClient, newWorkspace } from "./helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("tool input validation", () => {
  test("a call with a missing field is an INVALID_INPUT envelope that names the field", async () => {
    const client = await connectClient();
    const result = await callTool(client, "list", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.message).toContain("list");
    expect(result.isError).toBe(true);
  });

  test("a call with a wrongly typed field is INVALID_INPUT", async () => {
    const client = await connectClient();
    const result = await callTool(client, "list", { registry: 7, trust: null });
    expect(result.error?.code).toBe("INVALID_INPUT");
  });
});

describe("plan_add on a missing directory", () => {
  test("canonicalizes the deepest existing ancestor and reports LOCKFILE_MISSING", async () => {
    const client = await connectAddClient(join(workspace, "home"));
    const result = await callTool(
      client,
      "plan_add",
      addInput(join(workspace, "does", "not", "exist")),
    );
    expect(result.error?.code).toBe("LOCKFILE_MISSING");
  });
});

describe("startMcpServer", () => {
  test("serves until stdin ends, then resolves with exit code 0", async () => {
    const previousExitCode = process.exitCode;
    const serving = startMcpServer();
    await new Promise((resolveTurn) => setTimeout(resolveTurn, 50));
    process.stdin.emit("end");
    await serving;
    expect(process.exitCode).toBe(0);
    process.exitCode = previousExitCode;
  });
});
