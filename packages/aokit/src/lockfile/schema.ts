import { z } from "zod";

export const currentLockfileVersion = 2;

const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const integrity = z.string().regex(/^sha256-[0-9a-f]{64}$/);

const registrySchema = z.strictObject({
  source: z.string().min(1),
  release: z.string().min(1),
  minCliVersion: semver,
  /** Set when the user trusted this Registry for the Project; absent for first-party ones. */
  trusted: z.boolean().optional(),
});

const moduleEntrySchema = z.strictObject({
  version: semver,
  registry: z.string().min(1),
  selected: z.boolean(),
  integrity,
  answers: z.record(z.string(), z.json()),
});

const fileEntrySchema = z.strictObject({
  owners: z.array(z.string().min(1)).min(1),
  mode: z.enum(["managed", "seed", "ejected"]),
  hash: integrity,
});

const depEntrySchema = z.strictObject({
  version: z.string().min(1),
  owners: z.array(z.string().min(1)),
  pinned: z.boolean(),
  source: z.enum(["catalog", "module", "user"]),
});

/**
 * Zod schema for lockfile format v2 (`aokit.lock.json`).
 */
export const lockfileSchema = z.strictObject({
  $schema: z.string().min(1),
  lockfileVersion: z.literal(currentLockfileVersion),
  cliVersion: semver,
  protocolVersion: z.number().int().positive(),
  layout: z.enum(["single", "monorepo"]),
  registries: z.record(z.string(), registrySchema),
  modules: z.record(z.string(), moduleEntrySchema),
  files: z.record(z.string(), fileEntrySchema),
  deps: z.record(z.string(), depEntrySchema),
});

export type Lockfile = z.infer<typeof lockfileSchema>;
