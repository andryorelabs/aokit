import { z } from "zod";

/**
 * The newest Registry index `schemaVersion` this CLI reads.
 */
export const supportedRegistrySchemaVersion = 1;

/**
 * Public URL of the versioned JSON Schema of the Registry index.
 */
export const registryIndexSchemaUrl = "https://aokit.dev/schema/registry/v1.json";

const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/, {
  message: "must be a semver version",
});

const integrity = z.string().regex(/^sha256:[0-9a-f]{64}$/, {
  message: "must be sha256:<lowercase hex>",
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
    }
  });

/**
 * The Registry index (`index.json`): Release, minimum CLI version, Catalog pointer and Module
 * versions with their integrity. A version entry's `files` maps each Module file path (relative to
 * `modules/<name>/<version>/`) to its integrity.
 */
export const registryIndexSchema = z.strictObject({
  $schema: z.string().default(registryIndexSchemaUrl),
  schemaVersion: z.literal(supportedRegistrySchemaVersion),
  name: z.string().min(1),
  release: z.string().min(1),
  minCliVersion: semver,
  catalog: z.strictObject({ path: relativePath, integrity }),
  modules: z.record(z.string().min(1), moduleEntry),
});

export type RegistryIndex = z.output<typeof registryIndexSchema>;
