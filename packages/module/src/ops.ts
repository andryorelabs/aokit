import { z } from "zod";

/**
 * Logical destinations a Module writes to; the Layout resolves them to paths.
 */
export const targetSchema = z.enum([
  "root",
  "config",
  "web",
  "server",
  "db",
  "shared-ui",
  "lib",
  "api-client",
  "extension",
  "emails",
  "jobs",
]);

const extensionPointName = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, {
  message: "Extension point names are dot-separated lowercase kebab-case, e.g. web.providers",
});

const extensionPointAddress = {
  extensionPoint: extensionPointName,
  range: z.string().min(1),
};

const codeOpFields = {
  target: targetSchema,
  ...extensionPointAddress,
};

const pathAddress = {
  target: targetSchema,
  file: z.string().min(1),
};

const cssAtRuleFields = {
  rule: z.enum(["import", "plugin", "theme", "layer", "utility", "keyframes", "custom-variant"]),
  params: z.string(),
  body: z.string().optional(),
};

const regionFields = {
  region: z.string().min(1),
  content: z.string(),
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
 * Deep-merges a value into a JSON/JSONC file, or into the node a `json` Extension point anchors; arrays union by value, keys sorted.
 */
const mergeJsonOpSchema = z.union([
  z.strictObject({ op: z.literal("mergeJson"), ...pathAddress, value: jsonObject }),
  z.strictObject({ op: z.literal("mergeJson"), ...extensionPointAddress, value: z.json() }),
]);

/**
 * Deep-merges a value into a YAML file through the Document API.
 */
const mergeYamlOpSchema = z.union([
  z.strictObject({ op: z.literal("mergeYaml"), ...pathAddress, value: jsonObject }),
  z.strictObject({ op: z.literal("mergeYaml"), ...extensionPointAddress, value: jsonObject }),
]);

/**
 * Adds env keys without overwriting existing ones.
 */
const addEnvOpSchema = z.union([
  z.strictObject({
    op: z.literal("addEnv"),
    target: targetSchema,
    file: z.string().min(1).optional(),
    entries: z.record(z.string(), z.string()),
  }),
  z.strictObject({
    op: z.literal("addEnv"),
    ...extensionPointAddress,
    entries: z.record(z.string(), z.string()),
  }),
]);

/**
 * Adds a Tailwind v4 at-rule through postcss. For `layer`, `utility`, `keyframes` and `custom-variant` the `body` is raw CSS placed inside the rule; nested content already present is left untouched.
 */
const addCssAtRuleOpSchema = z.union([
  z.strictObject({ op: z.literal("addCssAtRule"), ...pathAddress, ...cssAtRuleFields }),
  z.strictObject({ op: z.literal("addCssAtRule"), ...extensionPointAddress, ...cssAtRuleFields }),
]);

/**
 * Sets CSS custom properties in the `theme` (`@theme`), `light` (`:root`) or `dark` (`.dark`) group of a stylesheet through postcss; an existing variable keeps its value unless the declaring Module overrides the Op.
 */
const addCssVariablesOpSchema = z.strictObject({
  op: z.literal("addCssVariables"),
  ...pathAddress,
  group: z.enum(["theme", "light", "dark"]),
  variables: z.record(z.string().min(1), z.string()),
});

/**
 * Writes a marker region in a Markdown file that only the declaring Module owns.
 */
const appendRegionOpSchema = z.union([
  z.strictObject({ op: z.literal("appendRegion"), ...pathAddress, ...regionFields }),
  z.strictObject({ op: z.literal("appendRegion"), ...extensionPointAddress, ...regionFields }),
]);

/**
 * The 9 Ops of the Ops catalog; each is told apart by `op`, and data Ops by their address.
 */
export const opSchema = z.union([
  addImportOpSchema,
  addToArrayOpSchema,
  registerAtOpSchema,
  mergeJsonOpSchema,
  mergeYamlOpSchema,
  addEnvOpSchema,
  addCssAtRuleOpSchema,
  addCssVariablesOpSchema,
  appendRegionOpSchema,
]);

type WithOptionalTarget<Variant> = Variant extends { target: unknown }
  ? Variant
  : Variant & { target?: undefined };

/**
 * A parsed Op. Extension point addressed data Ops carry no `target`; it is typed as absent so every Op can be read uniformly.
 */
export type Op = WithOptionalTarget<z.output<typeof opSchema>>;
