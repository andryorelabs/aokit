import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { AokitError } from "../../src/cli/envelope.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { parseLockfile } from "../../src/lockfile/index.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";
import { renderFromLockfile } from "../../src/pipeline/index.ts";
import { readLocalRegistry } from "../../src/registry/index.ts";
import { resolveUpdateTarget } from "../../src/update/target.ts";
import { cleanTemporaryDirectories, createProject, temporaryDirectory } from "../diff/support.ts";
import { parseJsonObject } from "../helpers/update-json.ts";

afterEach(cleanTemporaryDirectories);

const secondCatalog = `${JSON.stringify(
  {
    release: "2026.11.1",
    dependencies: { oxfmt: "0.75.0", oxlint: "1.91.0" },
    pinGroups: { oxc: ["oxlint", "oxfmt"] },
  },
  null,
  2,
)}\n`;

async function publishSecondRelease(out: string): Promise<void> {
  const source = await writeRegistrySourceFixture();
  const modulePath = join(source, "oxc/module.ts");
  const text = await readFile(modulePath, "utf8");
  await writeFile(modulePath, text.replace('version: "1.0.0"', 'version: "1.1.0"'), "utf8");
  await writeFile(join(source, "catalog/2026.11.1.json"), secondCatalog, "utf8");
  await buildRegistry(source, out);
}

async function twoReleaseProject(): Promise<{
  directory: string;
  registryPath: string;
  lockfile: Lockfile;
}> {
  const source = await writeRegistrySourceFixture();
  const registryPath = await temporaryDirectory();
  await mkdir(registryPath, { recursive: true });
  await buildRegistry(source, registryPath);
  const directory = await createProject(registryPath);
  await publishSecondRelease(registryPath);
  const text = await readFile(join(directory, "aokit.lock.json"), "utf8");
  return { directory, registryPath, lockfile: parseLockfile(text).lockfile };
}

async function failure(action: () => unknown): Promise<AokitError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AokitError) return error;
    throw error;
  }
  throw new Error("expected an AokitError");
}

test("the target is the latest Release with the version it fixes per Module", async () => {
  const { registryPath, lockfile } = await twoReleaseProject();
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  expect(lockfile.registries[registry.name]?.release).toBe("2026.11.0");
  const target = resolveUpdateTarget(lockfile, registry);
  expect(target.release).toBe("2026.11.1");
  expect(target.versions).toEqual({ oxc: "1.1.0" });
  expect(target.upToDate).toBe(false);
});

test("--to the locked Release picks that Release's versions, not the latest", async () => {
  const { registryPath, lockfile } = await twoReleaseProject();
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  expect(registry.modules.get("oxc")?.manifest.version).toBe("1.1.0");
  const target = resolveUpdateTarget(lockfile, registry, "2026.11.0");
  expect(target.release).toBe("2026.11.0");
  expect(target.versions).toEqual({ oxc: "1.0.0" });
  expect(target.upToDate).toBe(true);
});

test("a Yanked version a Release Catalog fixes is never selected by an update", async () => {
  const source = await writeRegistrySourceFixture();
  const registryPath = await temporaryDirectory();
  await mkdir(registryPath, { recursive: true });
  await buildRegistry(source, registryPath);
  const directory = await createProject(registryPath);
  const lockfile = parseLockfile(
    await readFile(join(directory, "aokit.lock.json"), "utf8"),
  ).lockfile;
  const second = await writeRegistrySourceFixture();
  const modulePath = join(second, "oxc/module.ts");
  const moduleText = await readFile(modulePath, "utf8");
  await writeFile(modulePath, moduleText.replace('version: "1.0.0"', 'version: "1.1.0"'), "utf8");
  const declared = { ...parseJsonObject(secondCatalog), modules: { oxc: "1.1.0" } };
  await writeFile(
    join(second, "catalog/2026.11.1.json"),
    `${JSON.stringify(declared, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(second, "yanked.json"), '["oxc@1.1.0"]\n', "utf8");
  await buildRegistry(second, registryPath);
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  const target = resolveUpdateTarget(lockfile, registry);
  expect(target.release).toBe("2026.11.1");
  expect(target.versions).toEqual({ oxc: "1.0.0" });
  const ahead: Lockfile = {
    ...lockfile,
    modules: Object.fromEntries(
      Object.entries(lockfile.modules).map(([name, entry]) => [
        name,
        { ...entry, version: "1.0.5" },
      ]),
    ),
  };
  expect(resolveUpdateTarget(ahead, registry).versions).toEqual({ oxc: "1.0.5" });
});

test("an older target is INVALID_INPUT", async () => {
  const { registryPath, lockfile } = await twoReleaseProject();
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  const advanced: Lockfile = {
    ...lockfile,
    registries: Object.fromEntries(
      Object.entries(lockfile.registries).map(([name, entry]) => [
        name,
        { ...entry, release: "2026.11.1" },
      ]),
    ),
  };
  const error = await failure(() => resolveUpdateTarget(advanced, registry, "2026.11.0"));
  expect(error.code).toBe("INVALID_INPUT");
  const unknown = await failure(() => resolveUpdateTarget(lockfile, registry, "2026.10.0"));
  expect(unknown.code).toBe("INVALID_INPUT");
});

test("a Lockfile at the target Release and versions is up to date", async () => {
  const { registryPath, lockfile } = await twoReleaseProject();
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  const current: Lockfile = {
    ...lockfile,
    registries: Object.fromEntries(
      Object.entries(lockfile.registries).map(([name, entry]) => [
        name,
        { ...entry, release: "2026.11.1" },
      ]),
    ),
    modules: Object.fromEntries(
      Object.entries(lockfile.modules).map(([name, entry]) => [
        name,
        { ...entry, version: "1.1.0" },
      ]),
    ),
  };
  expect(resolveUpdateTarget(current, registry).upToDate).toBe(true);
});

test("a locked Module absent from the Registry is MODULE_VERSION_UNAVAILABLE naming remove", async () => {
  const { registryPath, lockfile } = await twoReleaseProject();
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  const oxc = lockfile.modules["oxc"];
  if (oxc === undefined) throw new Error("oxc missing");
  const withGone: Lockfile = { ...lockfile, modules: { ...lockfile.modules, gone: oxc } };
  const error = await failure(() => resolveUpdateTarget(withGone, registry));
  expect(error.code).toBe("MODULE_VERSION_UNAVAILABLE");
  expect(error.fix).toContain("aokit remove gone");
});

test("renderFromLockfile renders the target Release Catalog and versions", async () => {
  const { directory, registryPath, lockfile } = await twoReleaseProject();
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  const target = resolveUpdateTarget(lockfile, registry);
  const rendered = await renderFromLockfile(lockfile, {
    projectDir: directory,
    bundledRegistryPath: registryPath,
    cliVersion,
    release: target.release,
    versionOverride: target.versions,
  });
  expect(rendered.lockfile.modules["oxc"]?.version).toBe("1.1.0");
  const registryEntry = Object.values(rendered.lockfile.registries)[0];
  expect(registryEntry?.release).toBe("2026.11.1");
  expect(JSON.stringify(rendered.lockfile.deps)).toContain("1.91.0");
});

test("renderFromLockfile rejects a Release the Registry never published", async () => {
  const { directory, registryPath, lockfile } = await twoReleaseProject();
  const error = await failure(() =>
    renderFromLockfile(lockfile, {
      projectDir: directory,
      bundledRegistryPath: registryPath,
      cliVersion,
      release: "2030.01.0",
    }),
  );
  expect(error.code).toBe("MODULE_VERSION_UNAVAILABLE");
});

test("renderFromLockfile reads answersOverride instead of the locked answers", async () => {
  const { directory, registryPath, lockfile } = await twoReleaseProject();
  const error = await failure(() =>
    renderFromLockfile(lockfile, {
      projectDir: directory,
      bundledRegistryPath: registryPath,
      cliVersion,
      answersOverride: { oxc: { router: { nested: true } } },
    }),
  );
  expect(error.code).toBe("INVALID_INPUT");
  expect(error.message).toContain("oxc.router");
});
