import { afterEach, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CommandContext, runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { recopyCommand } from "../../src/cli/commands/recopy.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { computeIntegrity } from "../../src/registry/index.ts";
import { editJson, type ServedRegistry } from "../registry-remote/served-registry.ts";
import {
  cleanUp,
  createBundledProject,
  isolatedContext,
  namedRegistryCopy,
  readLockfileJson,
  served,
  snapshotTree,
  temporaryDirectory,
} from "./support.ts";

afterEach(cleanUp);

const lifecycleDefaults = { yes: true, install: false, allowDirty: true };

/** Creates a Project whose only Registry is the served `acme` copy. */
async function createRemoteProject(
  context: CommandContext,
  server: ServedRegistry,
  modules: string,
): Promise<string> {
  const directory = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory,
    modules,
    registry: server.url,
    trust: [server.url],
    yes: true,
    install: false,
  });
  expect(created).toMatchObject({ ok: true });
  return directory;
}

/** The kept offline copy of the document `url` served. */
function keptCopy(context: CommandContext, url: string): string {
  return join(
    context.env["XDG_CACHE_HOME"] ?? "",
    "aokit",
    "registry-index",
    `${new Bun.CryptoHasher("sha256").update(url).digest("hex")}.json`,
  );
}

test("recopy renders the newest version of a remote Module whose locked version is gone", async () => {
  const context = await isolatedContext();
  const project = await createBundledProject(context);
  const server = served(await namedRegistryCopy("acme"));
  const added = await runCommand(addCommand, context, {
    ...lifecycleDefaults,
    directory: project,
    modules: ["knip"],
    registry: server.url,
    trust: [server.url],
  });
  expect(added).toMatchObject({ ok: true });
  const lockfilePath = join(project, "aokit.lock.json");
  const lockfile = JSON.parse(await readFile(lockfilePath, "utf8"));
  lockfile.modules.knip.version = "0.9.0";
  await writeFile(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`, "utf8");
  const recopied = await runCommand(recopyCommand, context, {
    ...lifecycleDefaults,
    directory: project,
  });
  expect(recopied).toMatchObject({
    ok: true,
    data: { substitutions: [{ module: "knip", locked: "0.9.0", rendered: "1.0.0" }] },
  });
  expect((await readLockfileJson(project))["modules"]["knip"]).toMatchObject({
    version: "1.0.0",
    registry: "acme",
  });
});

test("add resolves a remote Module's requires from the same remote Registry", async () => {
  const context = await isolatedContext();
  const server = served(await namedRegistryCopy("acme"));
  const project = await createRemoteProject(context, server, "oxc");
  const added = await runCommand(addCommand, context, {
    ...lifecycleDefaults,
    directory: project,
    modules: ["coolify"],
  });
  expect(added).toMatchObject({ ok: true, data: { added: ["coolify"], pulledIn: ["docker"] } });
  const lockfile = await readLockfileJson(project);
  expect(lockfile["modules"]["coolify"]["registry"]).toBe("acme");
  expect(lockfile["modules"]["docker"]["registry"]).toBe("acme");
});

test("a kept offline index never moves the Project to a Release it does not record", async () => {
  const context = await isolatedContext();
  const server = served(await namedRegistryCopy("acme"));
  const project = await createRemoteProject(context, server, "oxc");
  const release: string = (await readLockfileJson(project))["registries"]["acme"]["release"];
  await server.stop();
  const forgedRelease = "2099.1.0";
  const currentCatalog = keptCopy(context, `${server.url}/catalog/${release}.json`);
  const forgedCatalog = keptCopy(context, `${server.url}/catalog/${forgedRelease}.json`);
  const catalog = JSON.parse(await readFile(currentCatalog, "utf8"));
  catalog.release = forgedRelease;
  const forgedText = `${JSON.stringify(catalog, null, 2)}\n`;
  await writeFile(forgedCatalog, forgedText, "utf8");
  await editJson(keptCopy(context, `${server.url}/index.json`), (index) => {
    const releases: unknown = index["releases"];
    if (typeof releases !== "object" || releases === null) throw new Error("index lacks releases");
    index["release"] = forgedRelease;
    Reflect.set(releases, forgedRelease, {
      path: `catalog/${forgedRelease}.json`,
      integrity: computeIntegrity(forgedText),
    });
  });
  const before = await snapshotTree(project);
  const updated = await runCommand(updateCommand, context, {
    ...lifecycleDefaults,
    directory: project,
  });
  expect(updated).toMatchObject({ ok: false, error: { code: "REGISTRY_INTEGRITY_MISMATCH" } });
  expect(JSON.stringify(updated)).toContain(forgedRelease);
  expect(await snapshotTree(project)).toEqual(before);
});
