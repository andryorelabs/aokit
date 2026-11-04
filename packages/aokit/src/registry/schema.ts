import { z } from "zod";
import type { Catalog } from "@aokit/module";
import type { Integrity } from "./integrity.ts";

/**
 * The newest Registry index `schemaVersion` this CLI reads.
 */
export const supportedRegistrySchemaVersion = 1;

/**
 * Public URL of the versioned JSON Schema of the Registry index.
 */
export const registryIndexSchemaUrl = "https://aokit.andryore.dev/schema/registry/v1.json";

const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/, {
  message: "must be a semver version",
});

const integrity = z
  .string()
  .refine((value): value is Integrity => /^sha256-[0-9a-f]{64}$/.test(value), {
    message: "must be sha256-<lowercase hex>",
  });

const relativePath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").some((part) => part === ".."),
    { message: "must be a relative path inside the Registry" },
  );

const versionEntry = z.strictObject({
  manifest: relativePath,
  integrity,
  schemaVersion: z.number().int().positive(),
  provides: z.array(z.string().min(1)),
  files: z.record(relativePath, integrity).default({}),
  yanked: z.literal(true).optional(),
});

const moduleEntry = z
  .strictObject({
    latest: semver,
    versions: z.record(semver, versionEntry),
  })
  .superRefine((entry, context) => {
    if (!(entry.latest in entry.versions)) {
      context.addIssue({
        code: "custom",
        path: ["latest"],
        message: `latest "${entry.latest}" is not one of the listed versions`,
      });
    } else if (entry.versions[entry.latest]?.yanked === true) {
      context.addIssue({
        code: "custom",
        path: ["latest"],
        message: `latest "${entry.latest}" is a Yanked version`,
      });
    }
  });

/**
 * The Registry index (`index.json`): current Release, minimum CLI version, a Catalog pointer for
 * every published Release, and every Module version with its integrity. A version with `yanked: true` is a Yanked version: never
 * `latest`, still served for Lockfiles that pin it. A version entry's
 * `integrity` covers its manifest and all its files; `files` maps each Module file path (relative
 * to `modules/<name>/<version>/`) to that file's own integrity.
 */
export const registryIndexSchema = z
  .strictObject({
    $schema: z.string().default(registryIndexSchemaUrl),
    schemaVersion: z.literal(supportedRegistrySchemaVersion),
    name: z.string().min(1),
    release: z.string().min(1),
    minCliVersion: semver,
    releases: z.record(z.string().min(1), z.strictObject({ path: relativePath, integrity })),
    modules: z.record(z.string().min(1), moduleEntry),
  })
  .superRefine((index, context) => {
    if (!(index.release in index.releases)) {
      context.addIssue({
        code: "custom",
        path: ["releases"],
        message: `release "${index.release}" is not one of the listed releases`,
      });
    }
  });

export type RegistryIndex = z.output<typeof registryIndexSchema>;

/**
 * The Module version map of a Release: Module name to the exact version that Release ships.
 */
export const releaseModulesSchema = z.record(z.string().min(1), semver);

/**
 * A Release Catalog as the Registry serves it: the dependency Catalog plus the Module version map.
 */
export type ReleaseCatalog = Catalog & { modules: Record<string, string> };

/**
 * The shape of a Catalog file before its `modules` map is split from the dependency Catalog.
 */
export const catalogFileSchema = z.record(z.string(), z.unknown());

/**
 * The Registry source `yanked.json`: `<module>@<version>` of every Yanked version.
 */
export const yankedListSchema = z.array(z.string().min(1));
