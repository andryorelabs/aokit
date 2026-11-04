import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { runCommand, type CommandContext } from "../../cli/command.ts";
import { addCommand } from "../../cli/commands/add.ts";
import { failureEnvelope, successEnvelope, type Envelope } from "../../cli/envelope.ts";
import { fromExplicitInput, toExplicitInput } from "../explicit-input.ts";
import { computePlanId, type PlanSession } from "../plan-id.ts";
import type { McpToolDefinition } from "./index.ts";

const planAddInput = toExplicitInput(addCommand.input);
const addInput = planAddInput.extend({
  planId: z.string().describe("The `planId` that `plan_add` returned for exactly this input"),
});

const lockfileName = "aokit.lock.json";

interface PlannedAdd {
  readonly data: Record<string, unknown>;
  readonly planId: string;
  readonly lockfileDigest: string;
}

/** The Lockfile digest each `planId` of a session was issued against. */
const lockfileDigests = new WeakMap<PlanSession, Map<string, string>>();

function digestsOf(session: PlanSession): Map<string, string> {
  const existing = lockfileDigests.get(session);
  if (existing !== undefined) return existing;
  const created = new Map<string, string>();
  lockfileDigests.set(session, created);
  return created;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissingPath(thrown: unknown): boolean {
  return (
    thrown instanceof Error &&
    "code" in thrown &&
    (thrown.code === "ENOENT" || thrown.code === "ENOTDIR")
  );
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

async function lockfileDigestOf(directory: string): Promise<string> {
  try {
    const bytes = await readFile(join(directory, lockfileName));
    return createHash("sha256").update(bytes).digest("hex");
  } catch (thrown) {
    if (isMissingPath(thrown)) return "";
    throw thrown;
  }
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
    message: `\`add\` needs a Plan reviewed in this session: ${reason}`,
    fix: "call `plan_add` with exactly this input, review the Plan, then call `add` with the `planId` it returns",
  });
}

/** Rewrites the CLI-worded trust failure so it names the explicit `trust` field an MCP agent can set. */
function withMcpTrustFix(envelope: Envelope): Envelope {
  const error = envelope.error;
  if (error?.code !== "REGISTRY_UNTRUSTED") return envelope;
  return failureEnvelope(
    {
      code: error.code,
      message: error.message.replace(/ Rerun with `[^`]*` to trust it\.$/, ""),
      fix: "ask the user whether to trust this Registry; if they agree, call the tool again with its name or source in the `trust` field (a list of Registry names or sources). `trust` is never granted implicitly",
    },
    envelope.data,
  );
}

/** The command input of an explicit tool input: `null` dropped, directory canonical, nothing installed. */
function commandInputOf(
  explicit: Readonly<Record<string, unknown>>,
  directory: string,
  dryRun: boolean,
): Record<string, unknown> {
  const { planId: _planId, ...rest } = explicit;
  return {
    ...fromExplicitInput(rest),
    directory,
    dryRun,
    install: false,
    allowDirty: false,
  };
}

function directoryOf(input: unknown): string {
  return isRecord(input) && typeof input["directory"] === "string" ? input["directory"] : "";
}

/**
 * Runs `add` as a dry run and derives its `planId` from the normalized input, the Project's
 * Lockfile (which pins the Release) and the Plan's VFS hash.
 */
async function planAdd(
  context: CommandContext,
  explicit: Readonly<Record<string, unknown>>,
  directory: string,
): Promise<
  | { readonly ok: true; readonly planned: PlannedAdd }
  | { readonly ok: false; readonly envelope: Envelope }
> {
  const commandInput = commandInputOf(explicit, directory, true);
  const envelope = await runCommand(addCommand, context, commandInput);
  if (!envelope.ok) return { ok: false, envelope: withMcpTrustFix(envelope) };
  const data = isRecord(envelope.data) ? envelope.data : {};
  const plan = isRecord(data["plan"]) ? data["plan"] : {};
  const vfsHash = typeof plan["hash"] === "string" ? plan["hash"] : "";
  const lockfileDigest = await lockfileDigestOf(directory);
  const { dryRun: _dryRun, ...normalized } = commandInput;
  const planId = computePlanId({ tool: "add", input: normalized }, lockfileDigest, vfsHash);
  return { ok: true, planned: { data, planId, lockfileDigest } };
}

function changesPackageJson(data: Record<string, unknown>): boolean {
  const plan = isRecord(data["plan"]) ? data["plan"] : {};
  const changes = Array.isArray(plan["changes"]) ? plan["changes"] : [];
  return changes.some(
    (change) =>
      isRecord(change) &&
      typeof change["path"] === "string" &&
      (change["path"] === "package.json" || change["path"].endsWith("/package.json")),
  );
}

export const planAddTool: McpToolDefinition = {
  name: "plan_add",
  description:
    "Resolve adding Modules to an existing Project (read from its Lockfile) and return the Plan without writing anything. Returns the `add` output plus a `planId` to pass to `add`. `directory` must be absolute.",
  input: planAddInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  async run(session: PlanSession, input: unknown, context: CommandContext): Promise<Envelope> {
    const explicit = isRecord(input) ? input : {};
    const requested = directoryOf(explicit);
    if (!isAbsolute(requested)) return relativeDirectoryFailure(requested);
    const planned = await planAdd(context, explicit, await canonicalDirectory(requested));
    if (!planned.ok) return planned.envelope;
    session.issue(planned.planned.planId);
    digestsOf(session).set(planned.planned.planId, planned.planned.lockfileDigest);
    return successEnvelope({
      ...planned.planned.data,
      planId: planned.planned.planId,
      nextSteps: [
        "show the Plan `changes` to the user",
        "call `add` with exactly the same input and this `planId` to write the Modules",
      ],
    });
  },
};

export const addTool: McpToolDefinition = {
  name: "add",
  description:
    "Add Modules to a Project that `plan_add` planned in this session. Takes the same input as `plan_add` plus its `planId`; fails with `PLAN_REQUIRED` and writes nothing when the id is unknown or the Plan, the Lockfile or the Project changed, and with `DIRTY_TREE` on uncommitted changes. Never runs `bun install`.",
  input: addInput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  async run(session: PlanSession, input: unknown, context: CommandContext): Promise<Envelope> {
    const explicit = isRecord(input) ? input : {};
    const requested = directoryOf(explicit);
    if (!isAbsolute(requested)) return relativeDirectoryFailure(requested);
    const planId = typeof explicit["planId"] === "string" ? explicit["planId"] : "";
    if (!session.has(planId))
      return planRequiredFailure("this `planId` was not issued by `plan_add` in this session");
    const directory = await canonicalDirectory(requested);
    if (digestsOf(session).get(planId) !== (await lockfileDigestOf(directory))) {
      return planRequiredFailure("the Lockfile changed since `plan_add`");
    }
    const replanned = await planAdd(context, explicit, directory);
    if (!replanned.ok) {
      const { code, message } = replanned.envelope.error ?? { code: "UNKNOWN", message: "" };
      if (code === "DIRTY_TREE") return replanned.envelope;
      return planRequiredFailure(`the Plan no longer applies (${code}: ${message})`);
    }
    if (replanned.planned.planId !== planId) {
      return planRequiredFailure("the input, the Lockfile or the Plan changed since `plan_add`");
    }
    const applied = await runCommand(
      addCommand,
      context,
      commandInputOf(explicit, directory, false),
    );
    if (!applied.ok) return applied;
    session.consume(planId);
    digestsOf(session).delete(planId);
    const data = isRecord(applied.data) ? applied.data : {};
    return successEnvelope({
      ...data,
      nextSteps: changesPackageJson(data) ? ["bun install"] : [],
    });
  },
};
