export { buildPlan, type BuildPlanOptions, type Removal } from "./build.ts";
export { EngineError, type EngineErrorCode } from "./errors.ts";
export { interpolateContent, interpolatePath, type AnswerValue } from "./interpolate.ts";
export { layoutTables, resolveTarget, type LayoutName, type Target } from "./layout.ts";
export {
  createOpRegistry,
  type DeclaredExtensionPoint,
  type EngineContext,
  type EngineModule,
  type OpContext,
  type OpHandler,
  type OpHandlers,
  type OpVfs,
} from "./ops.ts";
export {
  diffVfs,
  hashVfs,
  type Formatter,
  type Plan,
  type PlanChange,
  type Provenance,
  type ProvenanceEntry,
} from "./plan.ts";
export { Vfs, type FileContent, type Ownership, type VfsFile, type WriteOptions } from "./vfs.ts";
