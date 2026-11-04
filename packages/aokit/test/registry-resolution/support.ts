import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { cliVersion } from "../../src/cli/version.ts";
import type { CommandContext } from "../../src/cli/command.ts";
import { bundledRegistryPath } from "../../src/registry/bundled.ts";
import {
  editJson,
  type ServedRegistry,
  serveRegistry,
} from "../registry-remote/served-registry.ts";

const temporaryDirectories: string[] = [];
const servers: ServedRegistry[] = [];
const savedEnvironment = {
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
};

/** A fresh directory removed by {@link cleanUp}. */
export async function temporaryDirectory(prefix = "aokit-resolution-"): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

/** Stops every server, restores the environment and removes every temporary directory. */
export async function cleanUp(): Promise<void> {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
}

/**
 * A command context whose Module cache and user config live in fresh directories. `process.env`
 * points at the same ones, for the commands that read Registries without the context.
 */
export async function isolatedContext(): Promise<CommandContext> {
  const cache = await temporaryDirectory("aokit-resolution-cache-");
  const config = await temporaryDirectory("aokit-resolution-config-");
  process.env.XDG_CACHE_HOME = cache;
  process.env.XDG_CONFIG_HOME = config;
  return {
    version: cliVersion,
    env: { XDG_CACHE_HOME: cache, XDG_CONFIG_HOME: config },
    commands: [],
  };
}

/** A copy of the bundled Registry whose index declares `name`, written under `root/subpath`. */
export async function namedRegistryCopy(
  name: string,
  root?: string,
  subpath = "",
): Promise<string> {
  const base = root ?? (await temporaryDirectory("aokit-resolution-registry-"));
  const target = join(base, subpath);
  await cp(bundledRegistryPath, target, { recursive: true });
  await editJson(join(target, "index.json"), (index) => {
    index["name"] = name;
  });
  return base;
}

/** Serves `root` over loopback HTTP until {@link cleanUp}. */
export function served(root: string): ServedRegistry {
  const server = serveRegistry(root);
  servers.push(server);
  return server;
}

/** Creates a Project from the bundled Registry with `oxc`. */
export async function createBundledProject(context: CommandContext): Promise<string> {
  const directory = join(await temporaryDirectory(), "app");
  const envelope = await runCommand(createCommand, context, {
    directory,
    modules: "oxc",
    yes: true,
    install: false,
  });
  if (!envelope.ok) throw new Error(`create failed: ${JSON.stringify(envelope)}`);
  return directory;
}

/** Every file of a directory, by relative path, as bytes. */
export async function snapshotTree(root: string): Promise<Map<string, string>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    // oxlint-disable-next-line eslint/no-await-in-loop -- a small test tree, read in order
    files.set(relative(root, path), (await readFile(path)).toString("base64"));
  }
  return files;
}

/** The parsed `aokit.lock.json` of a Project. */
export async function readLockfileJson(directory: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(directory, "aokit.lock.json"), "utf8"));
}
