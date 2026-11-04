import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { AokitError } from "../cli/envelope.ts";
import { xdgConfigDir } from "../xdg.ts";

/** The environment the user config path is derived from. */
type UserConfigEnvironment = Readonly<Record<string, string | undefined>>;

const trustedRegistrySchema = z.strictObject({
  name: z.string().min(1),
  source: z.string().min(1),
});

const namespaceNamePattern = /^@[a-z0-9][a-z0-9._-]*$/;

const namespaceConfigSchema = z.strictObject({
  url: z
    .string()
    .min(1)
    .refine((url) => url.includes("{name}"), { message: "a Namespace url must contain {name}" }),
  headers: z.record(z.string().min(1), z.string()).optional(),
});

const userConfigSchema = z.looseObject({
  trustedRegistries: z.array(trustedRegistrySchema).default([]),
  registries: z
    .record(
      z.string().regex(namespaceNamePattern, { message: "a Namespace is named like @acme" }),
      namespaceConfigSchema,
    )
    .optional(),
});

/** A Registry the user allowed for every Project: its name and the source it was allowed for. */
export type TrustedRegistryEntry = z.infer<typeof trustedRegistrySchema>;

/**
 * A Namespace as the user config declares it: a shadcn Registry URL template holding `{name}` and
 * request headers. Both may hold `${VAR}` placeholders, which are stored and kept as written.
 */
export type NamespaceConfig = z.infer<typeof namespaceConfigSchema>;

/** The parts of the user config aokit reads. */
export interface UserConfig {
  readonly trustedRegistries: readonly TrustedRegistryEntry[];
  /** Namespaces by name (`@acme`), present only when the file declares `registries`. */
  readonly registries?: Readonly<Record<string, NamespaceConfig>>;
}

/** The user config file: `$XDG_CONFIG_HOME/aokit/config.json` (default `~/.config/aokit`). */
export function userConfigPath(env: UserConfigEnvironment = process.env): string {
  return join(xdgConfigDir(env), "config.json");
}

function invalidConfig(path: string, reason: string): AokitError {
  return new AokitError(
    "INVALID_INPUT",
    `The user config ${path} is invalid: ${reason}.`,
    'Fix the file or remove it; `trustedRegistries` is a list of `{ "name", "source" }` objects and `registries` maps `@name` to `{ "url", "headers" }` with `{name}` in the url.',
    { path },
  );
}

async function readConfigText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (thrown) {
    if (thrown instanceof Error && "code" in thrown && thrown.code === "ENOENT") {
      return undefined;
    }
    throw new AokitError(
      "IO_ERROR",
      `Cannot read the user config ${path}.`,
      "Check its permissions.",
      {
        path,
      },
    );
  }
}

async function readRawConfig(path: string): Promise<z.infer<typeof userConfigSchema>> {
  const text = await readConfigText(path);
  if (text === undefined) {
    return { trustedRegistries: [] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalidConfig(path, "it is not valid JSON");
  }
  const parsed = userConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw invalidConfig(path, z.prettifyError(parsed.error).replaceAll("\n", " "));
  }
  return parsed.data;
}

/**
 * Reads and validates the user config. A missing file is an empty allowlist; an unreadable or
 * invalid one fails with `INVALID_INPUT` naming the file.
 */
export async function loadUserConfig(
  env: UserConfigEnvironment = process.env,
): Promise<UserConfig> {
  const raw = await readRawConfig(userConfigPath(env));
  return raw.registries === undefined
    ? { trustedRegistries: raw.trustedRegistries }
    : { trustedRegistries: raw.trustedRegistries, registries: raw.registries };
}

/**
 * Adds a Registry to the user config allowlist, creating the file when needed and keeping every
 * other key. An entry already listed is not added twice.
 */
export async function addTrustedRegistry(
  entry: TrustedRegistryEntry,
  env: UserConfigEnvironment = process.env,
): Promise<void> {
  const path = userConfigPath(env);
  const raw = await readRawConfig(path);
  const listed = raw.trustedRegistries.some(
    (existing) => existing.name === entry.name && existing.source === entry.source,
  );
  if (listed) {
    return;
  }
  const next = { ...raw, trustedRegistries: [...raw.trustedRegistries, { ...entry }] };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`);
  await rename(temporary, path);
}
