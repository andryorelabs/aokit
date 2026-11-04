import { z } from "zod";
import { opSchema, targetSchema } from "./ops";

/**
 * The newest manifest `schemaVersion` this release of `@aokit/module` reads.
 */
export const supportedManifestSchemaVersion = 1;

/**
 * Public URL of the versioned JSON Schema of the manifest.
 */
export const manifestSchemaUrl = "https://aokit.andryore.dev/schema/module/v1.json";

const kebabName = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
  message: "must be lowercase kebab-case",
});

const capabilityName = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*(:[a-z0-9]+(-[a-z0-9]+)*)*$/, {
  message: "must be a lowercase kebab-case capability, optionally namespaced with ':'",
});

const requirement = z.union([
  capabilityName,
  z.string().regex(/^ext:[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+@\S+$/, {
    message: "must be a capability or an extension point as ext:<name>@<range>",
  }),
]);

const semver = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/, {
  message: "must be a semver version",
});

const cardinality = z.union([
  z.strictObject({ max: z.number().int().positive() }),
  z.literal("many"),
]);

const provideEntry = z
  .union([
    capabilityName,
    z.strictObject({ capability: capabilityName, cardinality: cardinality.optional() }),
  ])
  .transform((entry) =>
    typeof entry === "string"
      ? { capability: entry, cardinality: { max: 1 } as z.output<typeof cardinality> }
      : { capability: entry.capability, cardinality: entry.cardinality ?? { max: 1 } },
  );

const fileEntry = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  target: targetSchema,
  mode: z
    .string()
    .regex(/^[0-7]{3,4}$/)
    .optional(),
  ownership: z.enum(["managed", "seed", "ejected"]).optional(),
});

const dependencyMap = z.record(
  z.string().min(1),
  z.strictObject({
    range: z.string().min(1),
    pinGroup: z.string().min(1).optional(),
  }),
);

const deps = z.strictObject({
  dependencies: dependencyMap.optional(),
  devDependencies: dependencyMap.optional(),
  peerDependencies: dependencyMap.optional(),
  optionalDependencies: dependencyMap.optional(),
});

const envEntry = z.strictObject({
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, { message: "must be an UPPER_SNAKE_CASE env key" }),
  scope: z.string().min(1),
  example: z.string().optional(),
  schema: z.string().optional(),
});

const answer = z.strictObject({
  type: z.enum(["string", "boolean", "number", "select"]),
  message: z.string().optional(),
  default: z.union([z.string(), z.boolean(), z.number()]).optional(),
  choices: z.array(z.string()).optional(),
});

const extensionPoint = z
  .strictObject({
    name: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/),
    version: semver,
    target: targetSchema,
    kind: z.enum(["array", "object", "import-list", "json", "region"]),
    anchor: z.string().min(1),
    file: z.string().min(1).optional(),
  })
  .superRefine((point, context) => {
    if ((point.kind === "json" || point.kind === "region") && point.file === undefined) {
      context.addIssue({
        code: "custom",
        path: ["file"],
        message: `extension point "${point.name}" of kind "${point.kind}" must declare the file it lives in, relative to its target`,
      });
    }
    if (point.kind === "json" && !point.anchor.startsWith("/")) {
      context.addIssue({
        code: "custom",
        path: ["anchor"],
        message: `extension point "${point.name}" of kind "json" needs a JSON pointer anchor starting with "/", got "${point.anchor}"`,
      });
    }
  });

const overrideEntry = z.union([
  z.strictObject({ file: z.string().min(1), reason: z.string().min(1) }),
  z.strictObject({ op: z.string().min(1), reason: z.string().min(1) }),
]);

const rangeComparator =
  /^(?:[<>]=?|=|~|\^)?v?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function isSemverRange(range: string): boolean {
  return range.split("||").every((part) => {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length === 3 && tokens[1] === "-") {
      return rangeComparator.test(tokens[0] ?? "") && rangeComparator.test(tokens[2] ?? "");
    }
    return tokens.every((token) => rangeComparator.test(token));
  });
}

const semverRange = z.string().refine(isSemverRange, { message: "must be a semver range" });

const migrationScriptPath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      !path.split("/").some((part) => part === ".." || part === ""),
    { message: "must be a relative path inside the Module version" },
  );

const migration = z.strictObject({
  from: semverRange,
  to: semver,
  stage: z.enum(["before", "after"]),
  script: migrationScriptPath,
});

/**
 * The single Zod source of truth for the Module manifest.
 */
export const manifestSchema = z.strictObject({
  $schema: z.string().default(manifestSchemaUrl),
  schemaVersion: z.literal(supportedManifestSchemaVersion).default(supportedManifestSchemaVersion),
  name: kebabName,
  version: semver,
  provides: z.array(provideEntry).default([]),
  requires: z.array(requirement).default([]),
  conflicts: z.array(capabilityName).default([]),
  answers: z.record(z.string().min(1), answer).optional(),
  files: z.array(fileEntry).default([]),
  deps: deps.optional(),
  env: z.array(envEntry).default([]),
  ops: z.array(opSchema).default([]),
  extensionPoints: z.array(extensionPoint).default([]),
  override: z.array(overrideEntry).default([]),
  migrations: z.array(migration).default([]),
});

/**
 * A validated, normalized manifest.
 */
export type ModuleManifest = z.output<typeof manifestSchema>;

/**
 * One manifest `migrations` entry: a Migration script run when an installed version matching
 * `from` moves to `to` or beyond.
 */
export type Migration = ModuleManifest["migrations"][number];

/**
 * What a Module author writes; defaults and bare-string `provides` are still allowed.
 */
export type ModuleManifestInput = z.input<typeof manifestSchema>;

/**
 * Raised when a manifest is invalid or newer than this CLI understands.
 */
export class ManifestError extends Error {
  readonly code: "manifest_invalid" | "manifest_schema_too_new";

  constructor(code: ManifestError["code"], message: string) {
    super(message);
    this.name = "ManifestError";
    this.code = code;
  }
}

/**
 * Validates raw manifest data. A newer `schemaVersion` fails telling the user to update the CLI;
 * unknown fields fail naming the field.
 */
export function parseManifest(raw: unknown): ModuleManifest {
  if (typeof raw === "object" && raw !== null && "schemaVersion" in raw) {
    const version: unknown = raw.schemaVersion;
    if (typeof version === "number" && version > supportedManifestSchemaVersion) {
      throw new ManifestError(
        "manifest_schema_too_new",
        `manifest schemaVersion ${version} is newer than the supported ${supportedManifestSchemaVersion}. Update the CLI.`,
      );
    }
  }
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
      )
      .join("; ");
    throw new ManifestError("manifest_invalid", `invalid module manifest: ${details}`);
  }
  return result.data;
}
