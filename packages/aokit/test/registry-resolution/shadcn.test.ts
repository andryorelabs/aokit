import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CommandContext, runCommand } from "../../src/cli/command.ts";
import { addCommand, runAdd } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { exitCodeForEnvelope } from "../../src/cli/envelope.ts";
import { parseRegistryDependency } from "../../src/project/registry.ts";
import { githubRawBaseUrl } from "../../src/registry/github.ts";
import { RegistryError } from "../../src/registry/index.ts";
import {
  type FixtureItem,
  removeShadcnFixtures,
  type ServedShadcnRegistry,
  serveShadcnRegistry,
} from "../registry-shadcn/served-shadcn-registry.ts";
import { cardItem, journeyItems, serveItemHost } from "../shadcn-journey/fixture.ts";
import {
  cleanUp,
  isolatedContext,
  readLockfileJson,
  served,
  snapshotTree,
  temporaryDirectory,
} from "./support.ts";

const stoppable: { stop(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(stoppable.splice(0).map((server) => server.stop()));
  await removeShadcnFixtures();
  await cleanUp();
});

const lifecycle = { yes: true, install: false, allowDirty: true };

async function shadcnRegistry(items: FixtureItem[]): Promise<ServedShadcnRegistry> {
  const registry = await serveShadcnRegistry(items);
  stoppable.push(registry);
  return registry;
}

async function styledProject(context: CommandContext): Promise<string> {
  const directory = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory,
    modules: "oxc,vite-react,tailwind4",
    yes: true,
    install: false,
    git: false,
  });
  await rm(join(directory, "README.md"), { force: true });
  expect(created).toMatchObject({ ok: true });
  return directory;
}

/** The journey Registry and card host, with the button added to a styled Project. */
async function projectWithButton(context: CommandContext): Promise<{
  project: string;
  fixture: ServedShadcnRegistry;
  trust: string[];
}> {
  const cards = await serveItemHost([cardItem()]);
  stoppable.push(cards);
  const fixture = await shadcnRegistry(journeyItems(cards.itemUrl("card")));
  const project = await styledProject(context);
  const trust = [fixture.url, cards.trustSource];
  const added = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: ["@fixture/button"],
    registry: fixture.url,
    trust,
  });
  expect(added).toMatchObject({ ok: true });
  return { project, fixture, trust };
}

function item(name: string, registryDependencies: string[] = []): FixtureItem {
  return {
    name,
    type: "registry:lib",
    registryDependencies,
    files: [
      {
        path: `lib/${name}.ts`,
        type: "registry:lib",
        content: `export const ${name.replaceAll("-", "")} = 1;\n`,
      },
    ],
  };
}

test("parseRegistryDependency reads the five address forms", () => {
  const owner = { registry: "fixture" };
  expect(parseRegistryDependency("utils", owner)).toEqual({
    form: "bare",
    address: "@fixture/utils",
  });
  expect(parseRegistryDependency("utils", { registry: "@acme" })).toEqual({
    form: "bare",
    address: "@acme/utils",
  });
  expect(parseRegistryDependency("@acme/button", owner)).toEqual({
    form: "namespaced",
    address: "@acme/button",
  });
  expect(parseRegistryDependency("acme/ui/button#v2", owner)).toEqual({
    form: "github",
    address: "github:acme/ui/button#v2",
  });
  expect(parseRegistryDependency("https://example.com/r/button.json", owner)).toEqual({
    form: "url",
    address: "https://example.com/r/button.json",
  });
  expect(parseRegistryDependency("./registry/button.json", owner)).toEqual({
    form: "path",
    address: "./registry/button.json",
  });
  let error: unknown;
  try {
    parseRegistryDependency("not a name", owner);
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(RegistryError);
  expect(error instanceof RegistryError && error.code).toBe("REGISTRY_SOURCE_UNSUPPORTED");
  expect(error instanceof RegistryError && error.message).toContain("not a name");
});

test("add <item-url> --trust --yes is ok and the Lockfile records the Registry", async () => {
  const context = await isolatedContext();
  const project = await styledProject(context);
  const host = await serveItemHost([cardItem()]);
  stoppable.push(host);
  const envelope = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: [host.itemUrl("card")],
    trust: [host.trustSource],
  });
  expect(envelope).toMatchObject({ ok: true });
  const [name] = addCommand.output.parse(envelope.ok ? envelope.data : undefined).added;
  expect(name).toMatch(/^@[a-z0-9-]+\/card$/);
  const lockfile = await readLockfileJson(project);
  const key: string = lockfile.modules[name ?? ""]?.["registry"] ?? "";
  expect(lockfile.registries[key]).toMatchObject({
    source: `${host.trustSource}/registry.json`,
    release: "shadcn",
    trusted: true,
  });
  expect(host.requests).toContain("r/card.json");
});

test("create --registry <shadcn-url> installs Adapted Modules and records the Registry", async () => {
  const context = await isolatedContext();
  const fixture = await shadcnRegistry([item("utils")]);
  const project = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory: project,
    modules: "@fixture/utils",
    registry: fixture.url,
    trust: [fixture.url],
    yes: true,
    install: false,
    git: false,
  });
  await rm(join(project, "README.md"), { force: true });
  expect(created).toMatchObject({ ok: true, data: { modules: ["@fixture/utils"] } });
  const lockfile = await readLockfileJson(project);
  expect(lockfile.registries["fixture"]).toMatchObject({
    source: `${fixture.url}/registry.json`,
    trusted: true,
  });
  const doctor = await runCommand(doctorCommand, context, { directory: project });
  expect(doctor).toMatchObject({ ok: true, data: { clean: true } });
});

test("create --registry <shadcn-url> follows registryDependencies and keeps the native Registry", async () => {
  const context = await isolatedContext();
  const cards = await serveItemHost([cardItem()]);
  stoppable.push(cards);
  const fixture = await shadcnRegistry(journeyItems(cards.itemUrl("card")));
  const project = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory: project,
    modules: "oxc,vite-react,tailwind4,@fixture/button",
    registry: fixture.url,
    trust: [fixture.url, cards.trustSource],
    yes: true,
    install: false,
    git: false,
  });
  await rm(join(project, "README.md"), { force: true });
  expect(created).toMatchObject({ ok: true });
  const lockfile = await readLockfileJson(project);
  const cardModule = Object.keys(lockfile.modules).find((name) => name.endsWith("/card"));
  expect(cardModule).toBeDefined();
  expect(lockfile.modules["@fixture/button"]).toMatchObject({ registry: "fixture" });
  expect(lockfile.modules["@fixture/utils"]).toMatchObject({
    registry: "fixture",
    selected: false,
  });
  const nativeKey: string = lockfile.modules["tailwind4"]?.["registry"] ?? "";
  expect(nativeKey).not.toBe("fixture");
  expect(lockfile.registries[nativeKey]).toMatchObject({ source: "bundled" });
  expect(lockfile.registries["fixture"]).toMatchObject({ trusted: true });
  const cardKey: string = lockfile.modules[cardModule ?? ""]?.["registry"] ?? "";
  expect(lockfile.registries[cardKey]).toMatchObject({
    source: `${cards.trustSource}/registry.json`,
    trusted: true,
  });
  const doctor = await runCommand(doctorCommand, context, { directory: project });
  expect(doctor).toMatchObject({ ok: true, data: { clean: true, problems: [] } });
});

test("create --registry <shadcn-url> asks each dependency Registry for its own trust", async () => {
  const context = await isolatedContext();
  const cards = await serveItemHost([cardItem()]);
  stoppable.push(cards);
  const fixture = await shadcnRegistry(journeyItems(cards.itemUrl("card")));
  const project = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory: project,
    modules: "oxc,vite-react,tailwind4,@fixture/button",
    registry: fixture.url,
    trust: [fixture.url],
    yes: true,
    install: false,
    git: false,
  });
  await rm(join(project, "README.md"), { force: true });
  expect(created).toMatchObject({ ok: false, error: { code: "REGISTRY_UNTRUSTED" } });
  expect(JSON.stringify(created)).toContain(cards.trustSource);
});

test("create --modules @ns/item reaches a Namespace of the user config", async () => {
  const context = await isolatedContext();
  const root = await temporaryDirectory("aokit-shadcn-create-namespace-");
  await mkdir(join(root, "a"), { recursive: true });
  await writeFile(join(root, "a", "alpha.json"), JSON.stringify(item("alpha")));
  const host = served(root);
  const configDir = join(context.env["XDG_CONFIG_HOME"] ?? "", "aokit");
  await mkdir(configDir, { recursive: true });
  const template = `${host.url}/a/{name}.json`;
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({ trustedRegistries: [], registries: { "@alpha": { url: template } } }),
  );
  const project = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory: project,
    modules: "oxc,@alpha/alpha",
    trust: [`@alpha=${template}`],
    yes: true,
    install: false,
    git: false,
  });
  await rm(join(project, "README.md"), { force: true });
  expect(created).toMatchObject({ ok: true });
  const lockfile = await readLockfileJson(project);
  expect(lockfile.modules["@alpha/alpha"]).toMatchObject({ selected: true });
  expect(lockfile.modules["oxc"]).toMatchObject({ selected: true });
});

test("update --registry <shadcn-url> reads the shadcn Registry of the Lockfile", async () => {
  const context = await isolatedContext();
  const { project, fixture, trust } = await projectWithButton(context);
  const updated = await runCommand(updateCommand, context, {
    ...lifecycle,
    directory: project,
    registry: fixture.url,
    trust,
  });
  expect(updated).toMatchObject({ ok: true });
});

test("after add @fixture/button the native Modules still render with their Catalog deps", async () => {
  const context = await isolatedContext();
  const { project } = await projectWithButton(context);
  const lockfile = await readLockfileJson(project);
  expect(lockfile.deps["oxlint"]).toMatchObject({ source: "catalog" });
  const doctor = await runCommand(doctorCommand, context, { directory: project });
  expect(doctor).toMatchObject({ ok: true, data: { clean: true, problems: [] } });
  const removed = await runCommand(removeCommand, context, {
    ...lifecycle,
    directory: project,
    module: "@fixture/button",
  });
  expect(removed).toMatchObject({ ok: true });
  expect((await readLockfileJson(project)).deps["oxlint"]).toEqual(lockfile.deps["oxlint"]);
});

test("a locked shadcn version keeps resolving after the item changes upstream", async () => {
  const context = await isolatedContext();
  const { project, fixture } = await projectWithButton(context);
  const locked: string =
    (await readLockfileJson(project)).modules["@fixture/utils"]?.["version"] ?? "";
  await fixture.writeItem({
    name: "utils",
    type: "registry:lib",
    files: [{ path: "lib/utils.ts", type: "registry:lib", content: "export const changed = 1;\n" }],
  });
  const doctor = await runCommand(doctorCommand, context, { directory: project });
  expect(doctor).toMatchObject({ ok: true, data: { clean: true, problems: [] } });
  expect((await readLockfileJson(project)).modules["@fixture/utils"]?.["version"]).toBe(locked);

  await rm(join(context.env["XDG_CACHE_HOME"] ?? "", "aokit", "registry"), {
    recursive: true,
    force: true,
  });
  const before = await snapshotTree(project);
  const removed = await runCommand(removeCommand, context, {
    ...lifecycle,
    directory: project,
    module: "@fixture/button",
  });
  expect(removed).toMatchObject({ ok: false, error: { code: "REGISTRY_ITEM_CHANGED" } });
  expect(exitCodeForEnvelope(removed)).toBe(1);
  const changedDoctor = await runCommand(doctorCommand, context, { directory: project });
  expect(changedDoctor).toMatchObject({ ok: false, error: { code: "REGISTRY_ITEM_CHANGED" } });
  expect(changedDoctor.ok ? "" : changedDoctor.error.fix).toContain("aokit update");
  expect(JSON.stringify(changedDoctor)).toContain("[REGISTRY_ITEM_CHANGED]");
  expect(exitCodeForEnvelope(changedDoctor)).toBe(1);
  expect(await snapshotTree(project)).toEqual(before);
});

test("doctor and remove read the Adapted Modules and their dependencies offline", async () => {
  const context = await isolatedContext();
  const cards = await serveItemHost([cardItem()]);
  const fixture = await serveShadcnRegistry(journeyItems(cards.itemUrl("card")));
  const project = await styledProject(context);
  const added = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: ["@fixture/button"],
    registry: fixture.url,
    trust: [fixture.url, cards.trustSource],
  });
  expect(added).toMatchObject({ ok: true });
  await Promise.all([fixture.stop(), cards.stop()]);
  const doctor = await runCommand(doctorCommand, context, { directory: project });
  expect(doctor).toMatchObject({ ok: true, data: { clean: true, problems: [] } });
  const dryRun = await runCommand(removeCommand, context, {
    ...lifecycle,
    directory: project,
    module: "oxc",
    dryRun: true,
  });
  expect(dryRun).toMatchObject({ ok: true, data: { removed: ["oxc"], orphans: [] } });
});

test("a network failure midway through add leaves the Project and Lockfile byte-identical", async () => {
  const context = await isolatedContext();
  const project = await styledProject(context);
  const cards = await serveItemHost([cardItem()]);
  stoppable.push(cards);
  const fixture = await shadcnRegistry(journeyItems(cards.itemUrl("card")));
  cards.failPaths.add("r/card.json");
  const before = await snapshotTree(project);
  const envelope = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: ["@fixture/button"],
    registry: fixture.url,
    trust: [fixture.url, cards.trustSource],
  });
  expect(envelope).toMatchObject({ ok: false, error: { code: "REGISTRY_FETCH_FAILED" } });
  expect(fixture.requests).toContain("button.json");
  expect(await snapshotTree(project)).toEqual(before);
});

test("registryDependencies between two items that need each other fail with an actionable error", async () => {
  const context = await isolatedContext();
  const project = await styledProject(context);
  const fixture = await shadcnRegistry([item("alpha", ["beta"]), item("beta", ["@fixture/alpha"])]);
  const before = await snapshotTree(project);
  const envelope = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: ["@fixture/alpha"],
    registry: fixture.url,
    trust: [fixture.url],
  });
  expect(envelope).toMatchObject({ ok: false, error: { code: "CAPABILITY_CONFLICT" } });
  const message = envelope.ok ? "" : envelope.error.message;
  expect(message).toContain("@fixture/alpha -> @fixture/beta -> @fixture/alpha");
  expect(envelope.ok ? "" : envelope.error.fix).toContain("break the cycle");
  expect(await snapshotTree(project)).toEqual(before);
});

test("two Namespaces on one host send each its own headers, and each is trusted on its own", async () => {
  const context = await isolatedContext();
  const root = await temporaryDirectory("aokit-shadcn-namespaces-");
  await mkdir(join(root, "a"), { recursive: true });
  await mkdir(join(root, "b"), { recursive: true });
  await writeFile(join(root, "a", "alpha.json"), JSON.stringify(item("alpha", ["@beta/beta"])));
  await writeFile(join(root, "b", "beta.json"), JSON.stringify(item("beta")));
  const host = served(root);
  const configDir = join(context.env["XDG_CONFIG_HOME"] ?? "", "aokit");
  await mkdir(configDir, { recursive: true });
  const alphaTemplate = `${host.url}/a/{name}.json`;
  const betaTemplate = `${host.url}/b/{name}.json`;
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({
      trustedRegistries: [],
      registries: {
        "@alpha": { url: alphaTemplate, headers: { "X-Alpha": "${ALPHA_TOKEN}" } },
        "@beta": { url: betaTemplate, headers: { "X-Beta": "${BETA_TOKEN}" } },
      },
    }),
  );
  const project = await styledProject(context);
  const secrets = { ALPHA_TOKEN: "alpha-secret-value", BETA_TOKEN: "beta-secret-value" };
  const withSecrets = { ...context, env: { ...context.env, ...secrets } };
  const untrusted = await runCommand(addCommand, withSecrets, {
    ...lifecycle,
    directory: project,
    modules: ["@alpha/alpha"],
    trust: [`@alpha=${alphaTemplate}`],
  });
  expect(untrusted).toMatchObject({ ok: false, error: { code: "REGISTRY_UNTRUSTED" } });
  expect(JSON.stringify(untrusted)).toContain("@beta");

  const added = await runCommand(addCommand, withSecrets, {
    ...lifecycle,
    directory: project,
    modules: ["@alpha/alpha"],
    trust: [`@alpha=${alphaTemplate}`, `@beta=${betaTemplate}`],
  });
  expect(added).toMatchObject({ ok: true, data: { pulledIn: ["@beta/beta"] } });
  const alphaRequests = host.received.filter((request) => request.path.startsWith("a/"));
  const betaRequests = host.received.filter((request) => request.path.startsWith("b/"));
  expect(alphaRequests.length).toBeGreaterThan(0);
  expect(betaRequests.length).toBeGreaterThan(0);
  for (const request of alphaRequests) {
    expect(request.headers["x-alpha"]).toBe("alpha-secret-value");
    expect(request.headers["x-beta"]).toBeUndefined();
  }
  for (const request of betaRequests) {
    expect(request.headers["x-beta"]).toBe("beta-secret-value");
    expect(request.headers["x-alpha"]).toBeUndefined();
  }
  const lockfileText = JSON.stringify(await readLockfileJson(project));
  expect(lockfileText).toContain(`@alpha=${alphaTemplate}`);
  expect(lockfileText).toContain(`@beta=${betaTemplate}`);
  expect(lockfileText).not.toContain("secret-value");
  expect(JSON.stringify(added)).not.toContain("secret-value");
});

test("an owner/repo/item#ref dependency is read through the github: transport, pinned to a sha40", async () => {
  const context = await isolatedContext();
  const sha = "a".repeat(40);
  const root = await temporaryDirectory("aokit-shadcn-github-");
  await mkdir(join(root, "acme", "ui", sha), { recursive: true });
  await writeFile(join(root, "acme", "ui", sha, "icon.json"), JSON.stringify(item("icon")));
  const raw = served(root);
  const fixture = await shadcnRegistry([item("toolbar", ["acme/ui/icon#v2"])]);
  const project = await styledProject(context);
  const lsRemoteCalls: string[] = [];
  const github = {
    rawBaseUrl: raw.url,
    lsRemote: (repositoryUrl: string, ref: string): Promise<string> => {
      lsRemoteCalls.push(`${repositoryUrl} ${ref}`);
      return Promise.resolve(`${sha}\trefs/tags/v2\n`);
    },
  };
  const added = await runAdd(
    context,
    addCommand.input.parse({
      ...lifecycle,
      directory: project,
      modules: ["@fixture/toolbar"],
      registry: fixture.url,
      trust: [fixture.url, "github:acme/ui"],
    }),
    { github },
  );
  expect(added.pulledIn).toHaveLength(1);
  expect(lsRemoteCalls).toEqual(["https://github.com/acme/ui.git v2"]);
  const lockfile = await readLockfileJson(project);
  const iconName = Object.keys(lockfile.modules).find((name) => name.endsWith("/icon"));
  const key: string = lockfile.modules[iconName ?? ""]?.["registry"] ?? "";
  expect(lockfile.registries[key]).toMatchObject({
    source: `github:acme/ui#${sha}`,
    trusted: true,
  });
});

/**
 * Replaces `globalThis.fetch` for the duration of `run` so commands that take no adapters reach the
 * raw GitHub host through the local fixture, and any other non-loopback request fails.
 */
async function withRawGithubAt<T>(rawUrl: string, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const rerouted = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(githubRawBaseUrl)) {
      return original(`${rawUrl}${url.slice(githubRawBaseUrl.length)}`, init);
    }
    if (new URL(url).hostname !== "127.0.0.1") {
      throw new Error(`unexpected network request to ${url}`);
    }
    return original(input, init);
  };
  globalThis.fetch = Object.assign(rerouted, { preconnect: original.preconnect });
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("an owner/repo/item#ref dependency is versioned from its commit SHA and stays in the lifecycle", async () => {
  const context = await isolatedContext();
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const root = await temporaryDirectory("aokit-shadcn-github-sha-");
  await mkdir(join(root, "acme", "ui", sha), { recursive: true });
  await writeFile(join(root, "acme", "ui", sha, "icon.json"), JSON.stringify(item("icon")));
  const raw = served(root);
  const fixture = await shadcnRegistry([item("toolbar", ["acme/ui/icon#v2"])]);
  const project = await styledProject(context);
  const github = { lsRemote: (): Promise<string> => Promise.resolve(`${sha}\trefs/tags/v2\n`) };
  await withRawGithubAt(raw.url, () =>
    runAdd(
      context,
      addCommand.input.parse({
        ...lifecycle,
        directory: project,
        modules: ["@fixture/toolbar"],
        registry: fixture.url,
        trust: [fixture.url, "github:acme/ui"],
      }),
      { github },
    ),
  );
  const lockfile = await readLockfileJson(project);
  const iconName = Object.keys(lockfile.modules).find((name) => name.endsWith("/icon")) ?? "";
  expect(lockfile.modules[iconName]?.["version"]).toBe(`0.0.0-shadcn.${sha.slice(0, 12)}`);
  const toolbarVersion: string = lockfile.modules["@fixture/toolbar"]?.["version"] ?? "";
  expect(toolbarVersion).toMatch(/^0\.0\.0-shadcn\.[0-9a-f]{12}$/);
  expect(toolbarVersion).not.toBe(`0.0.0-shadcn.${sha.slice(0, 12)}`);

  await withRawGithubAt(raw.url, async () => {
    const doctor = await runCommand(doctorCommand, context, { directory: project });
    expect(doctor).toMatchObject({ ok: true, data: { clean: true, problems: [] } });
    const updated = await runCommand(updateCommand, context, {
      ...lifecycle,
      directory: project,
    });
    expect(updated).toMatchObject({ ok: true });
    expect((await readLockfileJson(project)).modules[iconName]?.["version"]).toBe(
      `0.0.0-shadcn.${sha.slice(0, 12)}`,
    );
    const removed = await runCommand(removeCommand, context, {
      ...lifecycle,
      directory: project,
      module: "@fixture/toolbar",
    });
    expect(removed).toMatchObject({ ok: true });
  });
  const after = await readLockfileJson(project);
  expect(Object.keys(after.modules).filter((name) => name.endsWith("/icon"))).toEqual([]);
});

test("an untrusted item's own URL dependency host receives no request", async () => {
  const context = await isolatedContext();
  const project = await styledProject(context);
  const dependencyHost = await serveItemHost([cardItem()]);
  stoppable.push(dependencyHost);
  const rootHost = await serveItemHost([item("panel", [dependencyHost.itemUrl("card")])]);
  stoppable.push(rootHost);
  const before = await snapshotTree(project);
  const envelope = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: [rootHost.itemUrl("panel")],
  });
  expect(envelope).toMatchObject({ ok: false, error: { code: "REGISTRY_UNTRUSTED" } });
  expect(JSON.stringify(envelope)).toContain(rootHost.trustSource);
  expect(dependencyHost.requests).toEqual([]);
  expect(await snapshotTree(project)).toEqual(before);
});

test("a registryDependencies item its host does not serve fails naming it and its dependent", async () => {
  const context = await isolatedContext();
  const project = await styledProject(context);
  const emptyHost = await serveItemHost([]);
  stoppable.push(emptyHost);
  const missingUrl = emptyHost.itemUrl("ghost");
  const fixture = await shadcnRegistry([item("haunted", [missingUrl])]);
  const before = await snapshotTree(project);
  const envelope = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: ["@fixture/haunted"],
    registry: fixture.url,
    trust: [fixture.url, emptyHost.trustSource],
  });
  expect(envelope).toMatchObject({ ok: false, error: { code: "MODULE_VERSION_UNAVAILABLE" } });
  const message = envelope.ok ? "" : envelope.error.message;
  expect(message).toContain(missingUrl);
  expect(message).toContain("@fixture/haunted");
  expect(await snapshotTree(project)).toEqual(before);
});

test("a bare registryDependencies name its Registry does not list fails naming it and its dependent", async () => {
  const context = await isolatedContext();
  const project = await styledProject(context);
  const fixture = await shadcnRegistry([item("lonely", ["absent"])]);
  const envelope = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: ["@fixture/lonely"],
    registry: fixture.url,
    trust: [fixture.url],
  });
  expect(envelope).toMatchObject({ ok: false, error: { code: "MODULE_VERSION_UNAVAILABLE" } });
  const message = envelope.ok ? "" : envelope.error.message;
  expect(message).toContain("@fixture/absent");
  expect(message).toContain("@fixture/lonely");
});
