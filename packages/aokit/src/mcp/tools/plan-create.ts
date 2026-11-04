import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { runCommand, type CommandContext } from "../../cli/command.ts";
import { createCommand } from "../../cli/commands/create.ts";
import { failureEnvelope, successEnvelope, type Envelope } from "../../cli/envelope.ts";
import { fromExplicitInput, toExplicitInput } from "../explicit-input.ts";
import { computePlanId, type PlanSession } from "../plan-id.ts";
import type { McpToolDefinition } from "./index.ts";

const planInput = toExplicitInput(createCommand.input);
const createInput = planInput.extend({
  planId: z.string().describe("The `planId` that `plan` returned for exactly this input"),
});

interface PlannedCreate {
  readonly data: Record<string, unknown>;
  readonly planId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolves `..` segments and every symlink of the deepest existing ancestor, so a plan and its
 * apply name the same directory on disk even when a link moves in between.
 */
async function canonicalDirectory(directory: string): Promise<string> {
  const normalized = resolve(directory);
  try {
    return await realpath(normalized);
  } catch (thrown) {
    if (!isMissingPath(thrown)) throw thrown;
    const parent = dirname(normalized);
    if (parent === normalized) return normalized;
    return join(await canonicalDirectory(parent), basename(normalized));
  }
}

function isMissingPath(thrown: unknown): boolean {
  return (
    thrown instanceof Error &&
    "code" in thrown &&
    (thrown.code === "ENOENT" || thrown.code === "ENOTDIR")
  );
}

function relativeDirectoryFailure(directory: string): Envelope {
  return failureEnvelope({
    code: "INVALID_INPUT",
    message: `\`directory\` must be an absolute path; got \`${directory}\``,
    fix: "pass an absolute path in `directory`, for example `/home/me/projects/my-app`; the server's working directory is not known to the agent",
  });
}

function planRequiredFailure(reason: string): Envelope {
  return failureEnvelope({
    code: "PLAN_REQUIRED",
    message: `\`create\` needs a Plan reviewed in this session: ${reason}`,
    fix: "call `plan` with exactly this input, review the Plan, then call `create` with the `planId` it returns",
  });
}

/** The command input of an explicit tool input: `null` dropped, directory canonical, nothing installed. */
function commandInputOf(
  explicit: Readonly<Record<string, unknown>>,
  directory: string,
  dryRun: boolean,
): Record<string, unknown> {
  const { planId: _planId, ...rest } = explicit;
  return { ...fromExplicitInput(rest), directory, dryRun, install: false };
}

/**
 * Runs `create` as a dry run and derives its `planId` from the normalized input, the resolved
 * Release and the Plan's VFS hash.
 */
async function planCreate(
  context: CommandContext,
  explicit: Readonly<Record<string, unknown>>,
  directory: string,
): Promise<
  | { readonly ok: true; readonly planned: PlannedCreate }
  | { readonly ok: false; readonly envelope: Envelope }
> {
  const commandInput = commandInputOf(explicit, directory, true);
  const envelope = await runCommand(createCommand, context, commandInput);
  if (!envelope.ok) return { ok: false, envelope };
  const data = isRecord(envelope.data) ? envelope.data : {};
  const plan = isRecord(data["plan"]) ? data["plan"] : {};
  const vfsHash = typeof plan["hash"] === "string" ? plan["hash"] : "";
  const { dryRun: _dryRun, ...normalized } = commandInput;
  const release = typeof data["release"] === "string" ? data["release"] : "";
  const planId = computePlanId({ tool: "create", input: normalized }, release, vfsHash);
  return { ok: true, planned: { data, planId } };
}

function directoryOf(input: unknown): string {
  return isRecord(input) && typeof input["directory"] === "string" ? input["directory"] : "";
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export const planTool: McpToolDefinition = {
  name: "plan",
  description:
    "Resolve a new Project and return its Plan without writing anything. Returns the `create` output plus a `planId` to pass to `create`. `directory` must be absolute.",
  input: planInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  async run(session: PlanSession, input: unknown, context: CommandContext): Promise<Envelope> {
    const explicit = isRecord(input) ? input : {};
    const requested = directoryOf(explicit);
    if (!isAbsolute(requested)) return relativeDirectoryFailure(requested);
    const planned = await planCreate(context, explicit, await canonicalDirectory(requested));
    if (!planned.ok) return planned.envelope;
    session.issue(planned.planned.planId);
    return successEnvelope({
      ...planned.planned.data,
      planId: planned.planned.planId,
      nextSteps: [
        "show the Plan `changes` to the user",
        "call `create` with exactly the same input and this `planId` to write the Project",
      ],
    });
  },
};

export const createTool: McpToolDefinition = {
  name: "create",
  description:
    "Write a new Project that `plan` returned in this session. Takes the same input as `plan` plus its `planId`; fails with `PLAN_REQUIRED` and writes nothing when the id is unknown or the Plan changed. Never runs `bun install`.",
  input: createInput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  async run(session: PlanSession, input: unknown, context: CommandContext): Promise<Envelope> {
    const explicit = isRecord(input) ? input : {};
    const requested = directoryOf(explicit);
    if (!isAbsolute(requested)) return relativeDirectoryFailure(requested);
    const planId = typeof explicit["planId"] === "string" ? explicit["planId"] : "";
    if (!session.has(planId))
      return planRequiredFailure("this `planId` was not issued by `plan` in this session");
    const directory = await canonicalDirectory(requested);
    const replanned = await planCreate(context, explicit, directory);
    if (!replanned.ok) return replanned.envelope;
    if (replanned.planned.planId !== planId) {
      return planRequiredFailure("the input, the Release or the Plan changed since `plan`");
    }
    const applied = await runCommand(
      createCommand,
      context,
      commandInputOf(explicit, directory, false),
    );
    if (!applied.ok) return applied;
    return successEnvelope({
      ...(isRecord(applied.data) ? applied.data : {}),
      nextSteps: [`cd ${shellWord(directory)}`, "bun install"],
    });
  },
};
