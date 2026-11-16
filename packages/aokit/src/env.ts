/**
 * A snapshot or stand-in for the process environment.
 */
export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Every environment variable the CLI reads or writes. A source file reads the environment only
 * through this module.
 */
export const ENVIRONMENT_VARIABLE_NAMES = [
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOME",
  "NO_COLOR",
  "FORCE_COLOR",
  "TERM",
  "CI",
  "AOKIT_NO_UPDATE_NOTIFIER",
  "AOKIT_AGENT",
  "CLAUDECODE",
  "CURSOR_AGENT",
  "CODEX_SANDBOX",
  "GEMINI_CLI",
  "NAPI_RS_NATIVE_LIBRARY_PATH",
] as const;

/**
 * The name of a variable the CLI uses.
 */
export type EnvironmentVariableName = (typeof ENVIRONMENT_VARIABLE_NAMES)[number];

const agentVariableNames = [
  "CI",
  "CLAUDECODE",
  "CURSOR_AGENT",
  "CODEX_SANDBOX",
  "GEMINI_CLI",
  "AOKIT_AGENT",
] as const satisfies readonly EnvironmentVariableName[];

/**
 * The live process environment.
 */
export function processEnvironment(): Environment {
  return process.env;
}

/**
 * The raw value of one variable, or `undefined` when it is unset.
 */
export function readVariable(env: Environment, name: EnvironmentVariableName): string | undefined {
  return env[name];
}

/**
 * The value of one variable, or `undefined` when it is unset or empty.
 */
export function readNonEmptyVariable(
  env: Environment,
  name: EnvironmentVariableName,
): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * The first set, non-empty value among the given variables.
 */
export function readFirstNonEmptyVariable(
  env: Environment,
  names: readonly EnvironmentVariableName[],
): string | undefined {
  for (const name of names) {
    const value = readNonEmptyVariable(env, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Whether `NO_COLOR` is set to a non-empty value.
 */
export function readNoColor(env: Environment): boolean {
  return readNonEmptyVariable(env, "NO_COLOR") !== undefined;
}

/**
 * Whether `FORCE_COLOR` is set to a non-empty value other than `0`.
 */
export function readForceColor(env: Environment): boolean {
  const value = readNonEmptyVariable(env, "FORCE_COLOR");
  return value !== undefined && value !== "0";
}

/**
 * Whether `TERM` is `dumb`.
 */
export function readIsDumbTerminal(env: Environment): boolean {
  return readVariable(env, "TERM") === "dumb";
}

/**
 * Whether the update notice is switched off with `AOKIT_NO_UPDATE_NOTIFIER=1`.
 */
export function readUpdateNotifierDisabled(env: Environment): boolean {
  return readVariable(env, "AOKIT_NO_UPDATE_NOTIFIER") === "1";
}

/**
 * Whether `CI` is set to a truthy value: not unset, empty, `0` or `false`.
 */
export function readIsContinuousIntegration(env: Environment): boolean {
  const value = readVariable(env, "CI");
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

/**
 * Whether a CI run or a coding agent is detected from the environment.
 */
export function readIsAgentRun(env: Environment): boolean {
  return readFirstNonEmptyVariable(env, agentVariableNames) !== undefined;
}

/**
 * Points the native library loader at an extracted library.
 */
export function setNativeLibraryPath(path: string): void {
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = path;
}

/**
 * Removes the native library loader override.
 */
export function clearNativeLibraryPath(): void {
  delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
}
