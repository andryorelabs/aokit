import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AokitError } from "../../src/cli/envelope.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { toAokitError } from "../../src/project/errors.ts";
import { openRegistry, parseRegistrySource, RegistryError } from "../../src/registry/index.ts";
import {
  builtFixtureRegistry,
  editJson,
  removeTemporaryDirectories,
  type ServedRegistry,
  serveRegistry,
} from "./served-registry.ts";

const context = { cliVersion: "0.1.0" };
const servers: ServedRegistry[] = [];
const fixtureIndexShape = z.looseObject({
  release: z.string(),
  releases: z.record(z.string(), z.looseObject({ path: z.string() })),
  modules: z.record(
    z.string(),
    z.looseObject({
      versions: z.record(
        z.string(),
        z.looseObject({ manifest: z.string(), files: z.record(z.string(), z.string()) }),
      ),
    }),
  ),
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await removeTemporaryDirectories();
});

async function served(root?: string): Promise<{ root: string; server: ServedRegistry }> {
  const directory = root ?? (await builtFixtureRegistry());
  const server = serveRegistry(directory);
  servers.push(server);
  return { root: directory, server };
}

function urlSource(url: string) {
  return parseRegistrySource(url, { projectDir: "/", bundledRegistryPath: "/" });
}

async function captureError(action: () => Promise<unknown>): Promise<RegistryError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RegistryError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a RegistryError");
}

type FixtureIndex = z.output<typeof fixtureIndexShape>;

async function fixtureIndex(root: string): Promise<FixtureIndex> {
  return fixtureIndexShape.parse(JSON.parse(await readFile(join(root, "index.json"), "utf8")));
}

async function editIndex(root: string, edit: (index: FixtureIndex) => void): Promise<void> {
  const index = await fixtureIndex(root);
  edit(index);
  await writeFile(join(root, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

test("reading one Module requests only index.json, the current Catalog and that Module's files", async () => {
  const { root, server } = await served();
  const index = await fixtureIndex(root);
  const registry = await openRegistry(urlSource(server.url), context);
  expect(server.requests).toEqual(["index.json", index.releases[index.release]?.path ?? ""]);
  const module = await registry.version("oxc", "1.0.0");
  const entry = index.modules.oxc?.versions["1.0.0"];
  const expectedModuleRequests = [
    entry?.manifest ?? "",
    ...Object.keys(entry?.files ?? {}).map((path) => `modules/oxc/1.0.0/${path}`),
  ];
  expect(server.requests.slice(2).toSorted()).toEqual(expectedModuleRequests.toSorted());
  expect(server.requests.some((path) => path.includes("knip"))).toBe(false);
  expect(module.manifest.name).toBe("oxc");
});

test("a URL Registry returns the same Module, files and integrity as its local directory", async () => {
  const { root, server } = await served();
  const remote = await openRegistry(urlSource(server.url), context);
  const local = await openRegistry({ kind: "local", path: root }, context);
  expect(remote.name).toBe(local.name);
  expect(remote.currentCatalog).toEqual(local.currentCatalog);
  const pairs = Object.keys(local.index.modules).flatMap((name) =>
    local.versions(name).map((version) => ({ name, version })),
  );
  const read = await Promise.all(
    pairs.map(async ({ name, version }) => ({
      fromUrl: await remote.version(name, version),
      fromDisk: await local.version(name, version),
    })),
  );
  expect(read.length).toBeGreaterThan(1);
  for (const { fromUrl, fromDisk } of read) {
    expect(fromUrl.integrity).toBe(fromDisk.integrity);
    expect(fromUrl.manifest).toEqual(fromDisk.manifest);
    expect([...fromUrl.files]).toEqual([...fromDisk.files]);
  }
});

test("a 500 on a Module file fails with REGISTRY_FETCH_FAILED, exit 1, naming the URL", async () => {
  const { server } = await served();
  const registry = await openRegistry(urlSource(server.url), context);
  server.failPaths.add("modules/oxc/1.0.0/module.json");
  const error = await captureError(() => registry.version("oxc", "1.0.0"));
  expect(error.code).toBe("REGISTRY_FETCH_FAILED");
  expect(error.message).toContain(`${server.url}/modules/oxc/1.0.0/module.json`);
  expect(error.data.status).toBe(500);
  const mapped = toAokitError(error);
  expect(mapped).toBeInstanceOf(AokitError);
  if (mapped instanceof AokitError) {
    expect(mapped.code).toBe("REGISTRY_FETCH_FAILED");
    expect(exitCodeForErrorCode(mapped.code)).toBe(1);
  }
});

test("a failed Module read can be retried once the server recovers", async () => {
  const { server } = await served();
  const registry = await openRegistry(urlSource(server.url), context);
  server.failPaths.add("modules/oxc/1.0.0/module.json");
  await captureError(() => registry.version("oxc", "1.0.0"));
  server.failPaths.clear();
  expect((await registry.version("oxc", "1.0.0")).version).toBe("1.0.0");
});

test("a 500 on the index fails with REGISTRY_FETCH_FAILED before anything else is requested", async () => {
  const { server } = await served();
  server.failPaths.add("index.json");
  const error = await captureError(() => openRegistry(urlSource(server.url), context));
  expect(error.code).toBe("REGISTRY_FETCH_FAILED");
  expect(server.requests).toEqual(["index.json"]);
});

test("an unreachable server fails with REGISTRY_FETCH_FAILED", async () => {
  const { server } = await served();
  const url = server.url;
  await server.stop();
  const error = await captureError(() => openRegistry(urlSource(url), context));
  expect(error.code).toBe("REGISTRY_FETCH_FAILED");
});

test("a URL without index.json fails with REGISTRY_NOT_FOUND", async () => {
  const empty = await mkdtemp(join(tmpdir(), "aokit-registry-empty-"));
  const { server } = await served(empty);
  const error = await captureError(() => openRegistry(urlSource(server.url), context));
  expect(error.code).toBe("REGISTRY_NOT_FOUND");
});

test("minCliVersion is checked from the index before any other request", async () => {
  const { root, server } = await served();
  await editJson(join(root, "index.json"), (index) => {
    index.minCliVersion = "99.0.0";
  });
  const error = await captureError(() => openRegistry(urlSource(server.url), context));
  expect(error.code).toBe("REGISTRY_CLI_TOO_OLD");
  expect(error.message).toContain("99.0.0");
  expect(server.requests).toEqual(["index.json"]);
});

test("an unknown schemaVersion is refused from the index before any other request", async () => {
  const { root, server } = await served();
  await editJson(join(root, "index.json"), (index) => {
    index.schemaVersion = 2;
  });
  const error = await captureError(() => openRegistry(urlSource(server.url), context));
  expect(error.code).toBe("REGISTRY_SCHEMA_TOO_NEW");
  expect(server.requests).toEqual(["index.json"]);
});

const hostilePaths = [
  "../../../etc/passwd",
  "/etc/passwd",
  "files/../../knip/2.1.0/x",
  "./files/a",
  "C:/x",
];

for (const hostile of hostilePaths) {
  test(`an index files entry "${hostile}" is rejected before any Module fetch`, async () => {
    const { root, server } = await served();
    const index = await fixtureIndex(root);
    const integrity = Object.values(index.modules.oxc?.versions["1.0.0"]?.files ?? {})[0];
    await editIndex(root, (parsed) => {
      const entry = parsed.modules.oxc?.versions["1.0.0"];
      if (entry !== undefined) {
        entry.files[hostile] = integrity ?? "";
      }
    });
    const error = await captureError(() => openRegistry(urlSource(server.url), context));
    expect(error.code).toBe("REGISTRY_PATH_UNSAFE");
    expect(error.message).toContain(hostile);
    expect(server.requests).toEqual(["index.json"]);
  });
}

test("a manifest path outside its Module directory is rejected before any fetch", async () => {
  const { root, server } = await served();
  await editIndex(root, (parsed) => {
    const entry = parsed.modules.oxc?.versions["1.0.0"];
    if (entry !== undefined) {
      entry.manifest = "modules/knip/2.1.0/module.json";
    }
  });
  const error = await captureError(() => openRegistry(urlSource(server.url), context));
  expect(error.code).toBe("REGISTRY_PATH_UNSAFE");
  expect(server.requests).toEqual(["index.json"]);
});

test("a Catalog path that escapes the Registry is rejected before any fetch", async () => {
  const { root, server } = await served();
  await editIndex(root, (parsed) => {
    const pointer = parsed.releases[parsed.release];
    if (pointer !== undefined) {
      pointer.path = "../secret.json";
    }
  });
  const error = await captureError(() => openRegistry(urlSource(server.url), context));
  expect(error.code).toBe("REGISTRY_PATH_UNSAFE");
  expect(server.requests).toEqual(["index.json"]);
});

test("a redirect to another host is followed and its content is still integrity-checked", async () => {
  const { root, server } = await served();
  const mirrorRoot = await mkdtemp(join(tmpdir(), "aokit-registry-mirror-"));
  await cp(root, mirrorRoot, { recursive: true });
  const mirror = (await served(mirrorRoot)).server;
  const notes = "modules/oxc/1.0.0/files/nested/notes.md";
  server.redirects.set(notes, `${mirror.url.replace("127.0.0.1", "localhost")}/${notes}`);
  const followed = await openRegistry(urlSource(server.url), context);
  expect((await followed.version("oxc", "1.0.0")).files.get("files/nested/notes.md")).toBe(
    "# {{name}}\n",
  );
  expect(mirror.requests).toEqual([notes]);
  await writeFile(join(mirrorRoot, notes), "# tampered\n");
  const tampered = await openRegistry(urlSource(server.url), context);
  const error = await captureError(() => tampered.version("oxc", "1.0.0"));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  expect(error.data.module).toBe("oxc@1.0.0");
});

test("a redirect to a host that is neither https nor loopback is refused before it is requested", async () => {
  const { server } = await served();
  const notes = "modules/oxc/1.0.0/files/nested/notes.md";
  server.redirects.set(notes, `http://192.0.2.1/${notes}`);
  const opened = await openRegistry(urlSource(server.url), context);
  const error = await captureError(() => opened.version("oxc", "1.0.0"));
  expect(error.code).toBe("REGISTRY_FETCH_FAILED");
  expect(error.message).toContain("neither https nor a loopback host");
});

test("the injected fetch is the only way a URL Registry reads, and its failure is REGISTRY_FETCH_FAILED", async () => {
  const requested: string[] = [];
  const failingFetch: typeof fetch = Object.assign(
    async (input: string | URL | Request) => {
      requested.push(input instanceof Request ? input.url : input.toString());
      throw new TypeError("network down");
    },
    { preconnect: fetch.preconnect },
  );
  const error = await captureError(() =>
    openRegistry(urlSource("https://r.test/base"), { ...context, fetch: failingFetch }),
  );
  expect(error.code).toBe("REGISTRY_FETCH_FAILED");
  expect(error.message).toContain("network down");
  expect(requested).toEqual(["https://r.test/base/index.json"]);
});
