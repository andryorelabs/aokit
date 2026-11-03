import { apply } from "../apply/index.ts";
import {
  type BuiltProject,
  type PipelineFailure,
  type PipelineInput,
  type PipelineModule,
  buildProject,
} from "./build.ts";

export { buildProject, type PipelineInput, type PipelineModule };
export { type RegistryInfo } from "./assemble.ts";
export { renderFromLockfile } from "./render.ts";

/** Result of {@link runPipeline}. */
export type PipelineResult = (BuiltProject & { readonly directory: string }) | PipelineFailure;

/** Builds the Project and, if resolution succeeded, applies it atomically to `directory`. */
export async function runPipeline(
  input: PipelineInput,
  directory: string,
  options: Parameters<typeof apply>[3] = {},
): Promise<PipelineResult> {
  const built = await buildProject(input);
  if (!built.ok) {
    return built;
  }
  const applied = await apply(built.plan, built.lockfile, directory, options);
  return { ...built, directory: applied.directory };
}
