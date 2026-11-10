import { z } from "zod";
import { catalogSchema } from "@aokit/module";
import { meetsMinCliVersion, minCliVersionFix } from "../../cli/min-cli-version.ts";
import { ensureEmbeddedRegistry } from "../embedded/extract.ts";
import { RegistryError } from "../errors.ts";
import {
  gitLsRemote,
  githubRawBaseUrl,
  githubTransport,
  pinnedGithubSource,
  resolveGithubPin,
} from "../github.ts";
import { computeIntegrity } from "../integrity.ts";
import {
  assertSafeRelativePath,
  localTransport,
  type RegistryTransport,
  urlTransport,
} from "../remote.ts";
import {
  catalogFileSchema,
  type ReleaseCatalog,
  type RegistryIndex,
  registryIndexSchema,
  releaseModulesSchema,
  supportedRegistrySchemaVersion,
} from "../schema.ts";
import type { RegistrySource } from "../source.ts";
import { type OpenRegistryContext, parseJson, rebuildFix, verifyIntegrity } from "./common.ts";

const indexPathsShape = z.looseObject({
  releases: z.record(z.string(), z.looseObject({ path: z.unknown() })).optional(),
  modules: z
    .record(
      z.string(),
      z.looseObject({
        versions: z
          .record(
            z.string(),
            z.looseObject({
              manifest: z.unknown(),
              files: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/**
 * The transport a source is read with, and the source the opened Registry reports: for `github:`
 * that is the Pin, `github:owner/repo#<sha40>`, so the Lockfile never records a moving ref.
 */
export async function transportFor(
  source: Exclude<RegistrySource, { kind: "shadcn" }>,
  context: OpenRegistryContext,
): Promise<{ transport: RegistryTransport; source: RegistrySource }> {
  const fetchImpl = context.fetch ?? fetch;
  if (source.kind === "url") {
    return { transport: urlTransport(source.url, fetchImpl), source };
  }
  if (source.kind === "github") {
    const pin = await resolveGithubPin(source, {
      lsRemote: context.github?.lsRemote ?? gitLsRemote,
    });
    return {
      transport: githubTransport(pin, context.github?.rawBaseUrl ?? githubRawBaseUrl, fetchImpl),
      source: pinnedGithubSource(pin),
    };
  }
  if (source.kind === "bundled") await ensureEmbeddedRegistry(process.env);
  return { transport: localTransport(source.path), source };
}

/**
 * Rejects every index path that is absolute or escapes its directory, on the raw index, so a
 * hostile path is refused before the schema is applied and before any fetch.
 */
function assertIndexPathsSafe(raw: unknown, location: string): void {
  const parsed = indexPathsShape.safeParse(raw);
  if (!parsed.success) {
    return;
  }
  for (const [release, pointer] of Object.entries(parsed.data.releases ?? {})) {
    if (typeof pointer.path === "string") {
      assertSafeRelativePath(pointer.path, `Registry index release ${release}`, location);
    }
  }
  for (const [name, moduleEntry] of Object.entries(parsed.data.modules ?? {})) {
    for (const [version, entry] of Object.entries(moduleEntry.versions ?? {})) {
      const subject = `Registry index Module ${name}@${version}`;
      if (typeof entry.manifest === "string") {
        assertSafeRelativePath(entry.manifest, subject, location);
        const moduleDirectory = `modules/${name}/${version}/`;
        if (!entry.manifest.startsWith(moduleDirectory)) {
          throw new RegistryError(
            "REGISTRY_PATH_UNSAFE",
            `${subject} lists the manifest "${entry.manifest}", which is outside ${moduleDirectory}.`,
            "The Registry index is malformed or hostile. Do not use it; rebuild it with `bun run registry:build`.",
            { registry: location, module: `${name}@${version}`, path: entry.manifest },
          );
        }
      }
      for (const path of Object.keys(entry.files ?? {})) {
        assertSafeRelativePath(path, subject, location);
      }
    }
  }
}

export function parseIndex(transport: RegistryTransport, text: string | undefined): RegistryIndex {
  const location = `${transport.location}/index.json`;
  if (text === undefined) {
    throw new RegistryError(
      "REGISTRY_NOT_FOUND",
      `No Registry index at ${location}.`,
      "Point --registry at a Registry that serves index.json, or run `bun run registry:build`.",
      { registry: transport.location, path: location },
    );
  }
  const raw = parseJson(
    text,
    (reason) =>
      new RegistryError(
        "REGISTRY_INDEX_INVALID",
        `Registry index ${location} is not valid JSON: ${reason}`,
        rebuildFix,
        { registry: transport.location, path: location },
      ),
  );
  const schemaVersion =
    typeof raw === "object" && raw !== null && "schemaVersion" in raw
      ? raw.schemaVersion
      : undefined;
  if (typeof schemaVersion === "number" && schemaVersion > supportedRegistrySchemaVersion) {
    throw new RegistryError(
      "REGISTRY_SCHEMA_TOO_NEW",
      `Registry index ${location} has schemaVersion ${schemaVersion}: expected <= ${supportedRegistrySchemaVersion}, actual ${schemaVersion}.`,
      "Update the aokit CLI to read this Registry.",
      {
        registry: transport.location,
        expected: `<= ${supportedRegistrySchemaVersion}`,
        actual: String(schemaVersion),
      },
    );
  }
  assertIndexPathsSafe(raw, transport.location);
  const parsed = registryIndexSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new RegistryError(
      "REGISTRY_INDEX_INVALID",
      `Registry index ${location} is invalid: ${issues}`,
      rebuildFix,
      { registry: transport.location, path: location },
    );
  }
  return parsed.data;
}

export function checkCliVersion(index: RegistryIndex, cliVersion: string): void {
  if (!meetsMinCliVersion(cliVersion, index.minCliVersion)) {
    throw new RegistryError(
      "REGISTRY_CLI_TOO_OLD",
      `Registry "${index.name}" release ${index.release} requires CLI ${index.minCliVersion} or newer: expected >= ${index.minCliVersion}, actual ${cliVersion}.`,
      minCliVersionFix(index.minCliVersion),
      { registry: index.name, expected: `>= ${index.minCliVersion}`, actual: cliVersion },
    );
  }
}

export async function readCatalog(
  transport: RegistryTransport,
  registryName: string,
  release: string,
  pointer: RegistryIndex["releases"][string],
): Promise<ReleaseCatalog> {
  const subject = `Registry "${registryName}" Catalog ${pointer.path}`;
  const text = await transport.read(pointer.path);
  if (text === undefined) {
    throw new RegistryError("REGISTRY_FILE_MISSING", `${subject} is missing.`, rebuildFix, {
      registry: registryName,
      path: pointer.path,
    });
  }
  verifyIntegrity(computeIntegrity(text), pointer.integrity, subject, {
    registry: registryName,
    path: pointer.path,
  });
  const invalid = (reason: string) =>
    new RegistryError(
      "REGISTRY_CATALOG_INVALID",
      `${subject} is invalid: ${reason}`,
      "Fix the Catalog source and rebuild the Registry.",
      { registry: registryName, path: pointer.path },
    );
  const file = catalogFileSchema.safeParse(parseJson(text, invalid));
  const { modules: rawModules, ...rawCatalog } = file.success ? file.data : {};
  const parsed = catalogSchema.safeParse(rawCatalog);
  const parsedModules = releaseModulesSchema.safeParse(rawModules);
  if (!parsed.success || !parsedModules.success) {
    const issues = [
      ...(parsed.success ? [] : parsed.error.issues),
      ...(parsedModules.success
        ? []
        : parsedModules.error.issues.map((issue) => ({
            ...issue,
            message: `modules: ${issue.message}`,
          }))),
    ];
    throw invalid(issues.map((issue) => issue.message).join("; "));
  }
  if (parsed.data.release !== release) {
    throw new RegistryError(
      "REGISTRY_RELEASE_MISMATCH",
      `${subject} belongs to another Release: expected ${release}, actual ${parsed.data.release ?? "(none)"}.`,
      `Point the index release ${release} at catalog/${release}.json, or set its "release" to ${release}, then rebuild.`,
      { registry: registryName, expected: release, actual: parsed.data.release ?? "(none)" },
    );
  }
  return { ...parsed.data, modules: parsedModules.data };
}
