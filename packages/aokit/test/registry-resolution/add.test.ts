import { afterEach, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { diffCommand } from "../../src/cli/commands/diff.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { exitCodeForEnvelope } from "../../src/cli/envelope.ts";
import { createRegistryCache } from "../../src/registry/cache.ts";
import { computeIntegrity, computeModuleIntegrity } from "../../src/registry/index.ts";
import { editJson } from "../registry-remote/served-registry.ts";
import {
  cleanUp,
  createBundledProject,
  isolatedContext,
  namedRegistryCopy,
  lockedIntegrity,
  readLockfileJson,
  served,
  snapshotTree,
  temporaryDirectory,
} from "./support.ts";

afterEach(cleanUp);

const addDefaults = { yes: true, install: false, allowDirty: true };

/** The object at `path` inside a parsed JSON document. */
function childOf(value: object, path: readonly string[]): object {
  let current: object = value;
  for (const key of path) {
    const next: unknown = Reflect.get(current, key);
    if (typeof next !== "object" || next === null) throw new Error(`no object at ${key}`);
    current = next;
  }
  return current;
}
test("an untrusted remote Registry fails with REGISTRY_UNTRUSTED (exit 5) and changes nothing", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("acme"));
  const before = await snapshotTree(project);
  const envelope = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
  });
  expect(envelope).toMatchObject({ ok: false, error: { code: "REGISTRY_UNTRUSTED" } });
  expect(exitCodeForEnvelope(envelope)).toBe(5);
  expect(JSON.stringify(envelope)).toContain("--trust");
  expect(await snapshotTree(project)).toEqual(before);
  expect(server.requests.some((path) => path.startsWith("modules/"))).toBe(false);
});

test("add --registry <url> --trust reads only that Module, records trust and shows the fetch", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("acme"));
  const envelope = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
    trust: [server.url],
  });
  expect(envelope).toMatchObject({ ok: true });
  const lockfile = await readLockfileJson(project);
  expect(lockfile.registries["acme"]).toMatchObject({ source: server.url, trusted: true });
  expect(lockfile.registries["official"]).toMatchObject({ source: "bundled" });
  expect(lockfile.registries["official"]?.["trusted"]).toBeUndefined();
  expect(lockfile.modules["knip"]?.["registry"]).toBe("acme");
  expect(lockfile.modules["oxc"]?.["registry"]).toBe("official");
  expect(envelope.ok && envelope.data).toMatchObject({
    fetched: [
      {
        module: "knip",
        registry: "acme",
        source: server.url,
        integrity: lockedIntegrity(lockfile, "knip"),
      },
    ],
  });
  const modulePaths = server.requests.filter((path) => path.startsWith("modules/"));
  expect(modulePaths.length).toBeGreaterThan(0);
  expect(modulePaths.every((path) => path.startsWith("modules/knip/"))).toBe(true);
});

test("without --registry a remote Registry wins over the bundled one, and locked Modules keep theirs", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("acme"));
  const first = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
    trust: [server.url],
  });
  expect(first).toMatchObject({ ok: true });
  const second = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["docker"],
  });
  expect(second).toMatchObject({ ok: true });
  const lockfile = await readLockfileJson(project);
  expect(lockfile.modules["docker"]?.["registry"]).toBe("acme");
  expect(lockfile.modules["knip"]?.["registry"]).toBe("acme");
  expect(lockfile.modules["oxc"]?.["registry"]).toBe("official");
  expect(lockfile.registries["acme"]?.["trusted"]).toBe(true);
});

test("two Registries declaring one name with different sources fail with INVALID_INPUT naming both", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("official"));
  const before = await snapshotTree(project);
  const envelope = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
    trust: [server.url],
  });
  expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  const message = envelope.ok ? "" : envelope.error.message;
  expect(message).toContain("bundled");
  expect(message).toContain(server.url);
  expect(await snapshotTree(project)).toEqual(before);
});

test("a network failure midway through add leaves the Project and Lockfile byte-identical", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("acme"));
  server.failPaths.add("modules/knip/1.1.0/files/knip.json");
  const before = await snapshotTree(project);
  const envelope = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
    trust: [server.url],
  });
  expect(envelope).toMatchObject({ ok: false, error: { code: "REGISTRY_FETCH_FAILED" } });
  expect(exitCodeForEnvelope(envelope)).toBe(1);
  expect(server.requests).toContain("modules/knip/1.1.0/files/knip.json");
  expect(await snapshotTree(project)).toEqual(before);
});

test("diff and remove read a trusted remote Registry offline from the warm cache", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("acme"));
  const added = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
    trust: [server.url],
  });
  expect(added).toMatchObject({ ok: true });
  await server.stop();
  const diffed = await runCommand(diffCommand, context, { directory: project });
  expect(diffed).toMatchObject({ ok: true, data: { files: [] } });
  const removed = await runCommand(removeCommand, context, {
    directory: project,
    module: "knip",
    yes: true,
    allowDirty: true,
  });
  expect(removed).toMatchObject({ ok: true });
  const lockfile = await readLockfileJson(project);
  expect(lockfile.modules["knip"]).toBeUndefined();
  expect(lockfile.registries["acme"]).toBeUndefined();
});

test("an edited kept index with a planted cache entry never authenticates a Module offline", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("acme"));
  const added = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
    trust: [server.url],
  });
  expect(added).toMatchObject({ ok: true });
  await server.stop();
  const cacheRoot = join(context.env["XDG_CACHE_HOME"] ?? "", "aokit");
  const cache = createRegistryCache({ dir: join(cacheRoot, "registry") });
  const genuine = await cache.get(lockedIntegrity(await readLockfileJson(project), "knip"));
  if (genuine === undefined) throw new Error("knip was not cached by add");
  const forgedFile = '{ "entry": ["evil.ts"] }\n';
  const files = new Map(genuine.files);
  files.set("files/knip.json", forgedFile);
  const forgedIntegrity = computeModuleIntegrity(genuine.manifest, files);
  await cache.put(forgedIntegrity, { manifest: genuine.manifest, files });
  const keptIndex = join(
    cacheRoot,
    "registry-index",
    `${new Bun.CryptoHasher("sha256").update(`${server.url}/index.json`).digest("hex")}.json`,
  );
  await editJson(keptIndex, (index) => {
    const entry = childOf(index, ["modules", "knip", "versions", "1.1.0"]);
    Reflect.set(entry, "integrity", forgedIntegrity);
    Reflect.set(childOf(entry, ["files"]), "files/knip.json", computeIntegrity(forgedFile));
  });
  const before = await snapshotTree(project);
  const removed = await runCommand(removeCommand, context, {
    directory: project,
    module: "oxc",
    yes: true,
    allowDirty: true,
  });
  expect(removed).toMatchObject({ ok: false, error: { code: "REGISTRY_INTEGRITY_MISMATCH" } });
  expect(await snapshotTree(project)).toEqual(before);
  const doctor = await runCommand(doctorCommand, context, { directory: project });
  expect(doctor).toMatchObject({ data: { problems: [{ kind: "integrity" }] } });
});

test("an edited kept index and Catalog never write forged dependency versions offline", async () => {
  const context = await isolatedContext();
  const server = served(await namedRegistryCopy("acme"));
  const project = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory: project,
    modules: "oxc",
    registry: server.url,
    trust: [server.url],
    yes: true,
    install: false,
    git: false,
  });
  await rm(join(project, "README.md"), { force: true });
  expect(created).toMatchObject({ ok: true });
  const lockfile = await readLockfileJson(project);
  expect(lockfile.deps["oxlint"]).toMatchObject({ source: "catalog" });
  await server.stop();
  const keptCopy = (url: string): string =>
    join(
      context.env["XDG_CACHE_HOME"] ?? "",
      "aokit",
      "registry-index",
      `${new Bun.CryptoHasher("sha256").update(url).digest("hex")}.json`,
    );
  const release: string = lockfile.registries["acme"]?.["release"] ?? "";
  const catalogPath = `catalog/${release}.json`;
  let forgedCatalog = "";
  await editJson(keptCopy(`${server.url}/${catalogPath}`), (catalog) => {
    Reflect.set(childOf(catalog, ["dependencies"]), "oxlint", "6.6.6");
  });
  forgedCatalog = await readFile(keptCopy(`${server.url}/${catalogPath}`), "utf8");
  await editJson(keptCopy(`${server.url}/index.json`), (index) => {
    Reflect.set(
      childOf(index, ["releases", release]),
      "integrity",
      computeIntegrity(forgedCatalog),
    );
  });
  const before = await snapshotTree(project);
  const removed = await runCommand(removeCommand, context, {
    directory: project,
    module: "oxc",
    yes: true,
    allowDirty: true,
  });
  expect(removed).toMatchObject({ ok: false, error: { code: "REGISTRY_INTEGRITY_MISMATCH" } });
  expect(JSON.stringify(removed)).toContain("6.6.6");
  expect(await snapshotTree(project)).toEqual(before);
});

test("doctor reads a trusted remote Registry offline from the warm cache and reports drift", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("acme"));
  const added = await runCommand(addCommand, context, {
    ...addDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
    trust: [server.url],
  });
  expect(added).toMatchObject({ ok: true });
  await server.stop();
  const clean = await runCommand(doctorCommand, context, { directory: project });
  expect(clean).toMatchObject({ ok: true, data: { clean: true, problems: [] } });
  await writeFile(join(project, "knip.json"), "{}\n", "utf8");
  const drifted = await runCommand(doctorCommand, context, { directory: project });
  expect(drifted).toMatchObject({
    ok: false,
    data: { byState: { modified: ["knip.json"] }, problems: [] },
  });
});
