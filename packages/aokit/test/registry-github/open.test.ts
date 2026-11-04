import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { toAokitError } from "../../src/project/errors.ts";
import { createRegistryCache } from "../../src/registry/cache.ts";
import {
  formatRegistrySource,
  openRegistry,
  parseRegistrySource,
  RegistryError,
} from "../../src/registry/index.ts";
import {
  builtFixtureRegistry,
  removeTemporaryDirectories,
  type ServedRegistry,
  serveRegistry,
} from "../registry-remote/served-registry.ts";

const sha = "abcdef0123456789abcdef0123456789abcdef01";
const sourceContext = { projectDir: "/work/app", bundledRegistryPath: "/bundled" };
const servers: ServedRegistry[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  await removeTemporaryDirectories();
});

/** Serves the fixture Registry the way raw.githubusercontent.com serves acme/mods at `sha`. */
async function servedRepository(): Promise<ServedRegistry> {
  const raw = await mkdtemp(join(tmpdir(), "aokit-registry-github-"));
  temporaryDirectories.push(raw);
  await cp(await builtFixtureRegistry(), join(raw, "acme", "mods", sha), { recursive: true });
  const server = serveRegistry(raw);
  servers.push(server);
  return server;
}

function countingLsRemote(output: string) {
  const adapter = {
    calls: 0,
    lsRemote: async () => {
      adapter.calls += 1;
      return output;
    },
  };
  return adapter;
}

test("a github: source is pinned to the resolved SHA and read from the raw base at that SHA", async () => {
  const server = await servedRepository();
  const git = countingLsRemote(`${sha}\trefs/heads/main\n`);
  const registry = await openRegistry(parseRegistrySource("github:acme/mods#main", sourceContext), {
    cliVersion: "0.1.0",
    github: { lsRemote: git.lsRemote, rawBaseUrl: server.url },
  });
  expect(formatRegistrySource(registry.source)).toBe(`github:acme/mods#${sha}`);
  expect(git.calls).toBe(1);
  const oxc = await registry.version("oxc", "1.0.0");
  expect(oxc.files.get("files/nested/notes.md")).toBe("# {{name}}\n");
  expect(server.requests.every((path) => path.startsWith(`acme/mods/${sha}/`))).toBe(true);
});

test("reopening the recorded Pin never re-resolves the ref", async () => {
  const server = await servedRepository();
  const git = countingLsRemote(`${"f".repeat(40)}\trefs/heads/main\n`);
  const recorded = parseRegistrySource(`github:acme/mods#${sha}`, sourceContext);
  const registry = await openRegistry(recorded, {
    cliVersion: "0.1.0",
    github: { lsRemote: git.lsRemote, rawBaseUrl: server.url },
  });
  expect(git.calls).toBe(0);
  expect(formatRegistrySource(registry.source)).toBe(`github:acme/mods#${sha}`);
  expect((await registry.version("oxc", "1.0.0")).name).toBe("oxc");
});

async function openFailure(source: string, lsRemote: () => Promise<string>): Promise<AokitError> {
  try {
    await openRegistry(parseRegistrySource(source, sourceContext), {
      cliVersion: "0.1.0",
      github: { lsRemote, rawBaseUrl: "http://127.0.0.1:9" },
    });
  } catch (error) {
    expect(error).toBeInstanceOf(RegistryError);
    const mapped = toAokitError(error);
    if (mapped instanceof AokitError) {
      return mapped;
    }
  }
  throw new Error("expected openRegistry to fail with a mapped AokitError");
}

test("a git ls-remote failure while opening is REGISTRY_FETCH_FAILED, exit 1", async () => {
  const error = await openFailure("github:acme/mods#main", () =>
    Promise.reject(new Error("could not resolve host")),
  );
  expect(error.code).toBe("REGISTRY_FETCH_FAILED");
  expect(exitCodeForErrorCode(error.code)).toBe(1);
});

test("a ref the repository lacks, or one shaped like a git option, is INVALID_INPUT", async () => {
  const missing = await openFailure("github:acme/mods#main", async () => "");
  expect(missing.code).toBe("INVALID_INPUT");
  const option = await openFailure("github:acme/mods#-x", async () => "");
  expect(option.code).toBe("INVALID_INPUT");
});

test("a pinned github: Module fetched once is served from the cache after the server stops", async () => {
  const server = await servedRepository();
  const cacheDir = await mkdtemp(join(tmpdir(), "aokit-registry-github-cache-"));
  temporaryDirectories.push(cacheDir);
  const options = {
    cliVersion: "0.1.0",
    cache: createRegistryCache({ dir: cacheDir }),
    github: { lsRemote: countingLsRemote("").lsRemote, rawBaseUrl: server.url },
  };
  const recorded = parseRegistrySource(`github:acme/mods#${sha}`, sourceContext);
  const fetched = await (await openRegistry(recorded, options)).version("oxc", "1.0.0");
  const reopened = await openRegistry(recorded, options);
  await server.stop();
  expect((await reopened.version("oxc", "1.0.0")).integrity).toBe(fetched.integrity);
});
