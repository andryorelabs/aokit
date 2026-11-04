import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { stableStringify } from "@aokit/module";
import { z } from "zod";
import { conflictFile, type ConflictWrite } from "../apply/conflicts.ts";
import { AokitError } from "../cli/envelope.ts";
import { Vfs, type FileContent } from "../engine/vfs.ts";
import type { Plan, PlanChange } from "../engine/plan.ts";
import type { Git } from "../git/git.ts";
import type { KeptDependency } from "../lifecycle/keep-deps.ts";
import { lockfileSchema, type Lockfile } from "../lockfile/schema.ts";
import { planFilePath, writeFileAtomically } from "./state.ts";

const lockfileName = "aokit.lock.json";

function isProjectRelative(path: string): boolean {
  return (
    path !== "" &&
    !isAbsolute(path) &&
    !path.includes("\0") &&
    !path.split(/[\\/]/).some((segment) => segment === "..")
  );
}

const projectPath = z.string().refine(isProjectRelative, "must be a path inside the Project");
const fingerprint = z.string().regex(/^sha256-[0-9a-f]{64}$/);

const encodedContentSchema = z.discriminatedUnion("encoding", [
  z.strictObject({ encoding: z.literal("utf8"), data: z.string() }),
  z.strictObject({ encoding: z.literal("base64"), data: z.string() }),
]);

const provenanceSchema = z.strictObject({
  module: z.string(),
  entry: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("file"), from: z.string() }),
    z.strictObject({ kind: z.literal("op"), op: z.string() }),
    z.strictObject({ kind: z.literal("remove") }),
    z.strictObject({ kind: z.literal("formatter") }),
  ]),
  overridden: z.literal(true).optional(),
});

const changeSchema = z.strictObject({
  type: z.enum(["create", "update", "delete", "rename"]),
  path: projectPath,
  renamedFrom: projectPath.optional(),
  content: encodedContentSchema.optional(),
  previousContent: encodedContentSchema.optional(),
  ownership: z.enum(["managed", "seed", "ejected"]),
  mode: z.string().nullable(),
  provenance: z.array(provenanceSchema),
});

const conflictSchema = z.strictObject({
  path: projectPath,
  merged: z.string().optional(),
  next: encodedContentSchema,
  base: z.string(),
  user: z.string(),
});

const keptDependencySchema = z.strictObject({
  name: z.string(),
  kept: z.string(),
  available: z.string(),
  reason: z.enum(["pinned", "user"]),
});

const migrationSchema = z.strictObject({
  module: z.string(),
  stage: z.enum(["before", "after"]),
  from: z.string(),
  to: z.string(),
  script: z.string(),
});

/** A Migration the update ran while building the Plan. */
type PlanMigration = z.infer<typeof migrationSchema>;

/** The on-disk shape of `<git-dir>/aokit/plan.json`; binary content is base64. */
export const planFileSchema = z.strictObject({
  cliVersion: z.string().min(1),
  targetRelease: z.string().min(1),
  lockfileHash: fingerprint.nullable(),
  userFileHashes: z.record(projectPath, fingerprint.nullable()),
  planHash: z.string().min(1),
  changes: z.array(changeSchema),
  conflicts: z.array(conflictSchema),
  targetLockfile: lockfileSchema,
  keptDeps: z.array(keptDependencySchema).default([]),
  migrations: z.array(migrationSchema).default([]),
});

/** The text committed as `schema/plan/v1.json`, generated from {@link planFileSchema}. */
export function planJsonSchemaText(): string {
  return stableStringify(z.toJSONSchema(planFileSchema, { io: "input" }));
}

/** A reviewed update: what `update --plan` saves and `update --apply` writes. */
export interface UpdatePlanFile {
  readonly cliVersion: string;
  readonly targetRelease: string;
  /** Fingerprint of `aokit.lock.json` when planned; `null` when it was missing. */
  readonly lockfileHash: string | null;
  /** Fingerprint of every user file the update read; `null` for a file that was missing. */
  readonly userFileHashes: Readonly<Record<string, string | null>>;
  readonly plan: Plan;
  readonly conflicts: readonly ConflictWrite[];
  readonly targetLockfile: Lockfile;
  /** Dependencies the update kept; absent means none. */
  readonly keptDeps?: readonly KeptDependency[];
  /** Migrations the update ran; absent means none. */
  readonly migrations?: readonly PlanMigration[];
}

type EncodedContent = z.infer<typeof encodedContentSchema>;
type EncodedChange = z.infer<typeof changeSchema>;
type EncodedConflict = z.infer<typeof conflictSchema>;

/** `sha256-<hex>` over the exact bytes; unlike drift hashing, line endings are not normalized. */
function fingerprintBytes(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Fingerprints each file under `directory`; `null` for a file that does not exist. */
export async function fingerprintFiles(
  directory: string,
  paths: readonly string[],
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    paths.map(async (path): Promise<[string, string | null]> => {
      try {
        return [path, fingerprintBytes(await readFile(join(directory, path)))];
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return [path, null];
        }
        throw error;
      }
    }),
  );
  return Object.fromEntries(entries.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function encodeContent(content: FileContent): EncodedContent {
  return typeof content === "string"
    ? { encoding: "utf8", data: content }
    : { encoding: "base64", data: Buffer.from(content).toString("base64") };
}

function decodeContent(content: EncodedContent): FileContent {
  return content.encoding === "utf8"
    ? content.data
    : new Uint8Array(Buffer.from(content.data, "base64"));
}

function encodeChange(change: PlanChange): EncodedChange {
  return {
    type: change.type,
    path: change.path,
    ...(change.renamedFrom === undefined ? {} : { renamedFrom: change.renamedFrom }),
    ...(change.content === undefined ? {} : { content: encodeContent(change.content) }),
    ...(change.previousContent === undefined
      ? {}
      : { previousContent: encodeContent(change.previousContent) }),
    ownership: change.ownership,
    mode: change.mode ?? null,
    provenance: change.provenance.map((entry) => ({ ...entry })),
  };
}

function decodeChange(change: EncodedChange): PlanChange {
  return {
    type: change.type,
    path: change.path,
    ...(change.renamedFrom === undefined ? {} : { renamedFrom: change.renamedFrom }),
    ...(change.content === undefined ? {} : { content: decodeContent(change.content) }),
    ...(change.previousContent === undefined
      ? {}
      : { previousContent: decodeContent(change.previousContent) }),
    ownership: change.ownership,
    mode: change.mode ?? undefined,
    provenance: change.provenance.map(({ overridden, ...rest }) =>
      overridden === true ? { ...rest, overridden } : rest,
    ),
  };
}

function encodeConflict(conflict: ConflictWrite): EncodedConflict {
  return {
    path: conflict.path,
    ...(conflict.merged === undefined ? {} : { merged: conflict.merged }),
    next: encodeContent(conflict.next),
    base: conflict.base,
    user: conflict.user,
  };
}

function decodeConflict(conflict: EncodedConflict): ConflictWrite {
  return {
    path: conflict.path,
    ...(conflict.merged === undefined ? {} : { merged: conflict.merged }),
    next: decodeContent(conflict.next),
    base: conflict.base,
    user: conflict.user,
  };
}

function vfsOfChanges(changes: readonly PlanChange[]): Vfs {
  const vfs = Vfs.empty();
  for (const change of changes) {
    if (change.type === "delete" || change.content === undefined) continue;
    vfs.write(change.path, change.content, {
      ownership: change.ownership,
      ...(change.mode === undefined ? {} : { mode: change.mode }),
    });
  }
  return vfs;
}

/** Writes the Plan to `<git-dir>/aokit/plan.json` (`.aokit/plan.json` outside git). */
export async function writePlanFile(
  projectDirectory: string,
  git: Git | undefined,
  plan: UpdatePlanFile,
): Promise<void> {
  const touched = [
    ...plan.plan.changes.flatMap((change) => [
      change.path,
      ...(change.renamedFrom === undefined ? [] : [change.renamedFrom]),
    ]),
    ...plan.conflicts.map(conflictFile),
  ].filter((path) => !(path in plan.userFileHashes));
  const userFileHashes = {
    ...plan.userFileHashes,
    ...(await fingerprintFiles(projectDirectory, [...new Set(touched)])),
  };
  const encoded = planFileSchema.parse({
    cliVersion: plan.cliVersion,
    targetRelease: plan.targetRelease,
    lockfileHash: plan.lockfileHash,
    userFileHashes,
    planHash: plan.plan.hash,
    changes: plan.plan.changes.map(encodeChange),
    conflicts: plan.conflicts.map(encodeConflict),
    targetLockfile: plan.targetLockfile,
    keptDeps: plan.keptDeps ?? [],
    migrations: plan.migrations ?? [],
  });
  await writeFileAtomically(
    await planFilePath(projectDirectory, git),
    `${JSON.stringify(encoded, null, 2)}\n`,
  );
}

/**
 * Reads and validates the saved Plan. Resolves `null` when there is none; a plan that does not
 * validate is `INVALID_INPUT`.
 */
export async function readPlanFile(
  projectDirectory: string,
  git: Git | undefined,
): Promise<UpdatePlanFile | null> {
  const path = await planFilePath(projectDirectory, git);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = planFileSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    throw new AokitError(
      "INVALID_INPUT",
      `The saved Plan ${path} is invalid: ${z.prettifyError(parsed.error)}`,
      "Delete it and run `aokit update --plan` again.",
    );
  }
  const encoded = parsed.data;
  const changes = encoded.changes.map(decodeChange);
  return {
    cliVersion: encoded.cliVersion,
    targetRelease: encoded.targetRelease,
    lockfileHash: encoded.lockfileHash,
    userFileHashes: encoded.userFileHashes,
    plan: { changes, hash: encoded.planHash, vfs: vfsOfChanges(changes) },
    conflicts: encoded.conflicts.map(decodeConflict),
    targetLockfile: encoded.targetLockfile,
    keptDeps: encoded.keptDeps,
    migrations: encoded.migrations,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Deletes the saved Plan; nothing happens when there is none. */
export async function deletePlanFile(
  projectDirectory: string,
  git: Git | undefined,
): Promise<void> {
  await rm(await planFilePath(projectDirectory, git), { force: true });
}

/** The `PLAN_MISSING` error `--apply` raises when `readPlanFile` found nothing. */
export function planMissingError(): AokitError {
  return new AokitError(
    "PLAN_MISSING",
    "There is no saved update Plan to apply.",
    "Run `aokit update --plan` first.",
  );
}

/**
 * Throws `PLAN_STALE` naming each file whose current bytes differ from the fingerprint recorded
 * when the Plan was made, the Lockfile included.
 */
export async function assertPlanFresh(directory: string, plan: UpdatePlanFile): Promise<void> {
  const recorded = { [lockfileName]: plan.lockfileHash, ...plan.userFileHashes };
  const current = await fingerprintFiles(directory, Object.keys(recorded));
  const stale = Object.entries(recorded)
    .filter(([path, hash]) => current[path] !== hash)
    .map(([path]) => path)
    .toSorted();
  if (stale.length === 0) return;
  throw new AokitError(
    "PLAN_STALE",
    `The saved Plan is stale: ${stale.join(", ")} changed since \`aokit update --plan\`.`,
    "Run `aokit update --plan` again to review the update against the current tree.",
    { stale },
  );
}
