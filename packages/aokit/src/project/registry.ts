export {
  type LoadProjectRegistriesOptions,
  type PinMove,
  type ProjectRegistries,
  type RegistryAdapters,
  type RegistrySourceContext,
  resolveRegistrySource,
} from "./registry/context.ts";
export { assertCatalogDepsAuthenticated } from "./registry/kept-index.ts";
export { parseRegistryDependency, type RegistryDependency } from "./registry/dependencies.ts";
export {
  loadProjectRegistries,
  openProjectRegistries,
  resolutionOrder,
} from "./registry/project-registries.ts";
export { openShadcnAddresses, type ShadcnAddressing } from "./registry/shadcn-addresses.ts";
export {
  openProjectRegistry,
  type OpenProjectRegistryOptions,
  primaryRegistryName,
  snapshotRegistry,
  type SnapshotScope,
} from "./registry/snapshot.ts";
export {
  type CreateRegistries,
  loadCreateRegistries,
  type LoadRegistryOptions,
  toPipelineModule,
} from "./registry/create.ts";
