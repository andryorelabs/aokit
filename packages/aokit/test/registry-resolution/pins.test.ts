import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { cliVersion } from "../../src/cli/version.ts";
import { runCreate } from "../../src/create/index.ts";
import type { RegistryAdapters } from "../../src/project/registry.ts";
import { runUpdate } from "../../src/update/run.ts";
import {
  cleanUp,
  isolatedContext,
  namedRegistryCopy,
  readLockfileJson,
  served,
  temporaryDirectory,
} from "./support.ts";

afterEach(cleanUp);

const v1 = "1111111111111111111111111111111111111111";
const v2 = "2222222222222222222222222222222222222222";

/** A raw-file host serving acme/mods at both SHAs, and an ls-remote that counts its calls. */
async function githubFixture() {
  const raw = await temporaryDirectory("aokit-resolution-raw-");
  await namedRegistryCopy("acme", raw, join("acme", "mods", v1));
  await namedRegistryCopy("acme", raw, join("acme", "mods", v2));
  const server = served(raw);
  const git = { calls: [] as string[] };
  const adapters: RegistryAdapters = {
    github: {
      rawBaseUrl: server.url,
      lsRemote: async (_url, ref) => {
        git.calls.push(ref);
        return `${v1}\trefs/tags/v1\n${v2}\trefs/tags/v2\n`;
      },
    },
  };
  return { adapters, git };
}

async function createFromGithub(adapters: RegistryAdapters, trust: string[]) {
  const context = await isolatedContext();
  const directory = join(await temporaryDirectory(), "app");
  const result = runCreate({
    directory,
    layout: "single",
    modules: ["oxc"],
    answers: [],
    registry: "github:acme/mods#v1",
    trust,
    dryRun: false,
    diff: false,
    install: false,
    version: cliVersion,
    env: context.env,
    adapters,
  });
  return { directory, context, result };
}

test("create --registry github:…#ref without --trust fails with REGISTRY_UNTRUSTED", async () => {
  const { adapters } = await githubFixture();
  const { result } = await createFromGithub(adapters, []);
  const error: unknown = await result.catch((thrown: unknown) => thrown);
  expect(error).toMatchObject({ code: "REGISTRY_UNTRUSTED" });
});

test("a github: Pin is recorded, a plain update never re-resolves it, update --registry moves it", async () => {
  const { adapters, git } = await githubFixture();
  const { directory, context, result } = await createFromGithub(adapters, ["github:acme/mods"]);
  await result;
  const created = await readLockfileJson(directory);
  expect(created["registries"]["acme"]).toMatchObject({
    source: `github:acme/mods#${v1}`,
    trusted: true,
  });
  expect(git.calls).toEqual(["v1"]);

  const update = {
    dir: directory,
    allowDirty: true,
    dryRun: false,
    diff: false,
    yes: true,
    install: false,
    cliVersion,
    adapters: { ...adapters, env: context.env },
  };
  const plain = await runUpdate(update);
  expect(plain.pins).toEqual([]);
  expect(git.calls).toEqual(["v1"]);
  expect((await readLockfileJson(directory))["registries"]["acme"]["source"]).toBe(
    `github:acme/mods#${v1}`,
  );

  const planned = await runUpdate({ ...update, dryRun: true, registry: "github:acme/mods#v2" });
  expect(planned.pins).toEqual([
    { registry: "acme", from: `github:acme/mods#${v1}`, to: `github:acme/mods#${v2}` },
  ]);
  expect((await readLockfileJson(directory))["registries"]["acme"]["source"]).toBe(
    `github:acme/mods#${v1}`,
  );

  const moved = await runUpdate({ ...update, registry: "github:acme/mods#v2" });
  expect(moved.applied).toBe(true);
  expect(moved.pins).toEqual(planned.pins);
  expect((await readLockfileJson(directory))["registries"]["acme"]).toMatchObject({
    source: `github:acme/mods#${v2}`,
    trusted: true,
  });
});
