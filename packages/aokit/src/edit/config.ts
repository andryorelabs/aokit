import { generateCode, parseModule } from "magicast";
import { EditError } from "./errors.ts";

/** The plain-object view of the first argument of `defineConfig({...})`. */
export type ConfigObject = Record<string, unknown>;

interface ProxifiedCall {
  readonly $type?: string;
  readonly $callee?: string;
  readonly $args?: readonly unknown[];
}

function isProxifiedCall(value: unknown): value is ProxifiedCall {
  return typeof value === "object" && value !== null && "$type" in value;
}

function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null;
}

/**
 * Edits `export default defineConfig({...})` with magicast and returns the new
 * source. Only for config-shaped objects; code Ops use locate and splice.
 */
export function editDefineConfig(
  fileName: string,
  source: string,
  mutate: (config: ConfigObject) => void,
  calleeName = "defineConfig",
): string {
  const module = parseModule(source);
  const call: unknown = module.exports["default"];
  if (!isProxifiedCall(call) || call.$type !== "function-call" || call.$callee !== calleeName) {
    throw new EditError(
      "edit.config-shape",
      `${fileName} must contain "export default ${calleeName}({...})".`,
      fileName,
    );
  }
  const config = call.$args?.[0];
  if (!isConfigObject(config)) {
    throw new EditError(
      "edit.config-shape",
      `${fileName}: the first argument of ${calleeName}() must be an object literal.`,
      fileName,
    );
  }
  mutate(config);
  return generateCode(module).code;
}
