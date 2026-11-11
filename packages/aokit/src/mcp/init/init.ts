import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  claudeAddInstructions,
  codexTomlBlock,
  jsonClientLayout,
  registerServer,
  type McpClient,
} from "./client-config.ts";

/** What `mcp init` did, or would do, for one client. */
export interface McpInitResult {
  client: McpClient;
  path: string | null;
  changed: boolean;
  content: string;
}

export interface McpInitOptions {
  client: McpClient;
  directory: string;
  print: boolean;
  dryRun: boolean;
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (thrown) {
    if (thrown instanceof Error && "code" in thrown && thrown.code === "ENOENT") return null;
    throw thrown;
  }
}

/** Registers the aokit server in a client config, or returns the text to add by hand. */
export async function initMcpClient(options: McpInitOptions): Promise<McpInitResult> {
  const { client } = options;
  if (client === "codex") {
    return { client, path: null, changed: false, content: codexTomlBlock };
  }
  if (client === "claude" && options.print) {
    return { client, path: null, changed: false, content: `${claudeAddInstructions}\n` };
  }
  const layout = jsonClientLayout(client);
  const file = join(options.directory, layout.path);
  const existing = await readIfPresent(file);
  const content = registerServer(layout.path, existing ?? "", layout);
  const changed = content !== (existing ?? "");
  if (changed && !options.dryRun) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return { client, path: layout.path, changed, content };
}
