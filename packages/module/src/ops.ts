import { z } from "zod";

/**
 * Logical destinations a Module writes to; the Layout resolves them to paths.
 */
export const targetSchema = z.enum(["root", "config", "web", "server", "db", "shared-ui"]);

const extensionPointName = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, {
  message: "Extension point names are dot-separated lowercase kebab-case, e.g. web.providers",
});

const codeOpFields = {
  target: targetSchema,
  extensionPoint: extensionPointName,
  range: z.string().min(1),
};

const dataOpFields = {
  target: targetSchema,
  file: z.string().min(1),
};

const jsonObject = z.record(z.string(), z.json());

/**
 * Adds a named, default or namespace import to a TS file, deduplicated.
 */
const addImportOpSchema = z
  .strictObject({
    op: z.literal("addImport"),
    ...codeOpFields,
    from: z.string().min(1),
    named: z.array(z.string().min(1)).optional(),
    default: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
  })
  .refine(
    (op) => (op.named?.length ?? 0) > 0 || op.default !== undefined || op.namespace !== undefined,
    { message: "addImport needs at least one of named, default or namespace" },
  );

/**
 * Appends or inserts an element in an array at an Extension point.
 */
const addToArrayOpSchema = z.strictObject({
  op: z.literal("addToArray"),
  ...codeOpFields,
  element: z.string().min(1),
});

/**
 * Registers an expression at an Extension point: `key: expr` in an object, or an entry in an import list.
 */
const registerAtOpSchema = z.strictObject({
  op: z.literal("registerAt"),
  ...codeOpFields,
  key: z.string().min(1).optional(),
  expression: z.string().min(1),
});

/**
 * Deep-merges a value into a JSON/JSONC file; arrays union by value, keys sorted.
 */
const mergeJsonOpSchema = z.strictObject({
  op: z.literal("mergeJson"),
  ...dataOpFields,
  value: jsonObject,
});

/**
 * Deep-merges a value into a YAML file through the Document API.
 */
const mergeYamlOpSchema = z.strictObject({
  op: z.literal("mergeYaml"),
  ...dataOpFields,
  value: jsonObject,
});

/**
 * Adds env keys without overwriting existing ones.
 */
const addEnvOpSchema = z.strictObject({
  op: z.literal("addEnv"),
  target: targetSchema,
  file: z.string().min(1).optional(),
  entries: z.record(z.string(), z.string()),
});

/**
 * Adds a Tailwind v4 at-rule through postcss.
 */
const addCssAtRuleOpSchema = z.strictObject({
  op: z.literal("addCssAtRule"),
  ...dataOpFields,
  rule: z.enum(["import", "plugin", "theme"]),
  params: z.string(),
  body: z.string().optional(),
});

/**
 * Writes a marker region in a Markdown file that only the declaring Module owns.
 */
const appendRegionOpSchema = z.strictObject({
  op: z.literal("appendRegion"),
  ...dataOpFields,
  region: z.string().min(1),
  content: z.string(),
});

/**
 * The 8 Ops of the Ops catalog, discriminated by `op`.
 */
export const opSchema = z.discriminatedUnion("op", [
  addImportOpSchema,
  addToArrayOpSchema,
  registerAtOpSchema,
  mergeJsonOpSchema,
  mergeYamlOpSchema,
  addEnvOpSchema,
  addCssAtRuleOpSchema,
  appendRegionOpSchema,
]);

export type Op = z.output<typeof opSchema>;
