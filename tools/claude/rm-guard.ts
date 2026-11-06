import { isAbsolute, relative, resolve, sep } from "node:path";

/** Locations a single `rm` may delete inside. */
export interface RmGuardRoots {
  repoRoot: string;
  tempDirectory: string;
}

/** The PreToolUse output that approves a command without a prompt. */
export const approvalOutput = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" },
});

const forbiddenCharacters = /[;&|<>`$(){}*?[\]!\\~#'"\n\r\t=]/;
const plainFlag = /^-[A-Za-z]+$/;

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation !== "" &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function isSafeTarget(target: string, roots: RmGuardRoots): boolean {
  if (target.split("/").includes("..")) {
    return false;
  }
  const resolved = resolve(roots.repoRoot, target);
  return isInside(roots.repoRoot, resolved) || isInside(roots.tempDirectory, resolved);
}

/**
 * Whether a shell command is a single plain `rm` whose literal targets stay
 * inside the repo or the system temp dir. Anything else is not approved and
 * falls back to the normal permission prompt.
 */
export function isApprovedRm(command: string, roots: RmGuardRoots): boolean {
  if (forbiddenCharacters.test(command)) {
    return false;
  }
  const tokens = command.trim().split(/ +/);
  if (tokens[0] !== "rm") {
    return false;
  }
  const flags = tokens.slice(1).filter((token) => token.startsWith("-"));
  const targets = tokens.slice(1).filter((token) => !token.startsWith("-"));
  if (targets.length === 0 || !flags.every((flag) => plainFlag.test(flag))) {
    return false;
  }
  return targets.every((target) => isSafeTarget(target, roots));
}

/** Extracts `tool_input.command` from the PreToolUse payload, if it is a string. */
export function readCommand(rawPayload: string): string | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return undefined;
  }
  if (typeof payload !== "object" || payload === null || !("tool_input" in payload)) {
    return undefined;
  }
  const toolInput = payload.tool_input;
  if (typeof toolInput !== "object" || toolInput === null || !("command" in toolInput)) {
    return undefined;
  }
  return typeof toolInput.command === "string" ? toolInput.command : undefined;
}
