export { catalogSchema, type Catalog, type CatalogInput } from "./catalog.ts";
export {
  compileModule,
  stableStringify,
  type CompiledModule,
  type CompileModuleOptions,
} from "./compile.ts";
export { defineModule } from "./define.ts";
export { generateManifestJsonSchema, manifestJsonSchemaText } from "./json-schema.ts";
export {
  ManifestError,
  manifestSchema,
  manifestSchemaUrl,
  legacyManifestDescription,
  parseManifest,
  type ParseManifestOptions,
  supportedManifestSchemaVersion,
  type Migration,
  type ModuleManifest,
  type ModuleManifestInput,
} from "./manifest.ts";
export {
  defineMigration,
  type MigrationContext,
  type MigrationFn,
  type MigrationInput,
  type MigrationVfs,
} from "./migration.ts";
export { opSchema, targetSchema, type Op } from "./ops.ts";
