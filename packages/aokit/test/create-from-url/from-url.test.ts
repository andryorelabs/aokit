import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { exitCodeForEnvelope } from "../../src/cli/envelope.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { readLockfileSource, renderFromSource } from "../../src/create/from.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";
import {
  builtRegistry,
  cleanTemporaryDirectories,
  createProject,
  temporaryDirectory,
} from "../diff/support.ts";
import { editProjectLockfile, parseLockfileJson } from "../helpers/registry-json.ts";
import { type ServedRegistry, serveRegistry } from "../registry-remote/served-registry.ts";

const context = { version: cliVersion, env: {}, commands: [] };
const servers: ServedRegistry[] = [];
const scratch: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true });
  await cleanTemporaryDirectories();
});

function setOfficialRegistry(
  lockfile: Lockfile,
  fields: { source: string; trusted?: boolean },
): void {
  const official = lockfile.registries["official"];
  if (official === undefined) throw new Error("the Project has no official Registry");
  official.source = fields.source;
  if (fields.trusted !== undefined) official.trusted = fields.trusted;
}

function serve(root: string): ServedRegistry {
  const server = serveRegistry(root);
  servers.push(server);
  return server;
}

function stubFetch(body: string, seen: string[]): typeof fetch {
  return Object.assign(
    (input: string | URL | Request) => {
      seen.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(new Response(body));
    },
    { preconnect: fetch.preconnect },
  );
}

function newDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "aokit-from-url-"));
  scratch.push(root);
  return join(root, "app");
}

function create(input: Record<string, unknown>) {
  return runCommand(createCommand, context, { yes: true, install: false, git: false, ...input });
}

async function bundledSource(): Promise<string> {
  const directory = newDirectory();
  const envelope = await create({ directory, modules: "oxc,vite-react,knip" });
  expect(envelope.ok).toBe(true);
  return directory;
}

async function isolatedEnvironment() {
  return {
    XDG_CACHE_HOME: await temporaryDirectory(),
    XDG_CONFIG_HOME: await temporaryDirectory(),
  };
}

async function remoteRegistryLockfile() {
  const registry = await builtRegistry();
  const registryServer = serve(registry);
  const project = await createProject(registry);
  await editProjectLockfile(project, (lockfile) => {
    setOfficialRegistry(lockfile, { source: registryServer.url });
  });
  return { registryServer, lockfileServer: serve(project) };
}

test("create --from <url> replays a served pristine Lockfile", async () => {
  const source = await bundledSource();
  const server = serve(source);
  const target = newDirectory();
  const envelope = await create({ directory: target, from: `${server.url}/aokit.lock.json` });
  expect(envelope.ok).toBe(true);
  expect(readFileSync(join(target, "aokit.lock.json"), "utf8")).toBe(
    readFileSync(join(source, "aokit.lock.json"), "utf8"),
  );
  expect(server.requests).toEqual(["aokit.lock.json"]);
});

test("a failed fetch is REGISTRY_FETCH_FAILED (exit 1) and writes nothing", async () => {
  const source = await bundledSource();
  const server = serve(source);
  server.failPaths.add("aokit.lock.json");
  const target = newDirectory();
  const envelope = await create({ directory: target, from: `${server.url}/aokit.lock.json` });
  expect(envelope).toMatchObject({ ok: false, error: { code: "REGISTRY_FETCH_FAILED" } });
  expect(exitCodeForEnvelope(envelope)).toBe(1);
  expect(existsSync(target)).toBe(false);
});

test("a missing Lockfile answers REGISTRY_FETCH_FAILED with the status", async () => {
  const server = serve(await temporaryDirectory());
  const url = `${server.url}/aokit.lock.json`;
  const thrown = await readLockfileSource(url).catch((error: unknown) => error);
  expect(thrown).toMatchObject({ code: "REGISTRY_FETCH_FAILED", data: { path: url, status: 404 } });
});

test("an unreachable server is REGISTRY_FETCH_FAILED", async () => {
  const server = serve(await temporaryDirectory());
  const url = `${server.url}/aokit.lock.json`;
  await server.stop();
  const thrown = await readLockfileSource(url).catch((error: unknown) => error);
  expect(thrown).toMatchObject({ code: "REGISTRY_FETCH_FAILED" });
});

test("readLockfileSource uses the injected fetch", async () => {
  const source = await bundledSource();
  const text = readFileSync(join(source, "aokit.lock.json"), "utf8");
  const seen: string[] = [];
  const injected = stubFetch(text, seen);
  const lockfile = await readLockfileSource("https://lock.test/aokit.lock.json", {
    fetch: injected,
  });
  expect(seen).toEqual(["https://lock.test/aokit.lock.json"]);
  expect(lockfile).toEqual(parseLockfileJson(text));
});

test("a served file that is not a Lockfile is INVALID_INPUT", async () => {
  const injected = stubFetch("{}", []);
  const thrown = await readLockfileSource("http://lock.test/x", { fetch: injected }).catch(
    (error: unknown) => error,
  );
  expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
});

test("a non-http URL scheme is INVALID_INPUT", async () => {
  const thrown = await readLockfileSource("ftp://lock.test/x").catch((error: unknown) => error);
  expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
});

test("an untrusted Registry named by a served Lockfile is REGISTRY_UNTRUSTED", async () => {
  const { registryServer, lockfileServer } = await remoteRegistryLockfile();
  const env = await isolatedEnvironment();
  const target = newDirectory();
  const thrown = await renderFromSource({
    from: `${lockfileServer.url}/aokit.lock.json`,
    directory: target,
    answers: [],
    cliVersion,
    adapters: { env },
  }).catch((error: unknown) => error);
  expect(thrown).toMatchObject({ code: "REGISTRY_UNTRUSTED" });
  expect(String(Reflect.get(Object(thrown), "message"))).toContain("--trust");
  expect(registryServer.requests.filter((path) => path.startsWith("modules/"))).toEqual([]);
  expect(existsSync(target)).toBe(false);
});

test("--trust lets a served Lockfile replay and records trusted: true", async () => {
  const { registryServer, lockfileServer } = await remoteRegistryLockfile();
  const env = await isolatedEnvironment();
  const rendered = await renderFromSource({
    from: `${lockfileServer.url}/aokit.lock.json`,
    directory: newDirectory(),
    answers: [],
    cliVersion,
    trust: [registryServer.url],
    adapters: { env },
  });
  expect(rendered.lockfile.registries["official"]).toMatchObject({
    source: registryServer.url,
    trusted: true,
  });
});

test("a served Lockfile cannot declare its own Registry trusted", async () => {
  const registry = await builtRegistry();
  const registryServer = serve(registry);
  const project = await createProject(registry);
  await editProjectLockfile(project, (lockfile) => {
    setOfficialRegistry(lockfile, { source: registryServer.url, trusted: true });
  });
  const lockfileServer = serve(project);
  const target = newDirectory();
  const thrown = await renderFromSource({
    from: `${lockfileServer.url}/aokit.lock.json`,
    directory: target,
    answers: [],
    cliVersion,
    adapters: { env: await isolatedEnvironment() },
  }).catch((error: unknown) => error);
  expect(thrown).toMatchObject({ code: "REGISTRY_UNTRUSTED" });
  expect(registryServer.requests.filter((path) => path.startsWith("modules/"))).toEqual([]);
  expect(existsSync(target)).toBe(false);
});

test("a served Lockfile cannot name a local Registry path", async () => {
  const registry = await builtRegistry();
  const project = await createProject(registry);
  await editProjectLockfile(project, (lockfile) => {
    setOfficialRegistry(lockfile, { source: registry });
  });
  const lockfileServer = serve(project);
  const target = newDirectory();
  const thrown = await renderFromSource({
    from: `${lockfileServer.url}/aokit.lock.json`,
    directory: target,
    answers: [],
    cliVersion,
    adapters: { env: await isolatedEnvironment() },
  }).catch((error: unknown) => error);
  expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
  expect(existsSync(target)).toBe(false);
});
