import {
  addTrustedRegistry,
  loadUserConfig,
  type UserConfig,
  userConfigPath,
} from "../config/user-config.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import type { Registry } from "../registry/client.ts";
import { RegistryError } from "../registry/errors.ts";
import { formatRegistrySource } from "../registry/source.ts";
import { sourceIdentity, sourceStringIdentity } from "./identity.ts";

type TrustEnvironment = Readonly<Record<string, string | undefined>>;

/** The part of an opened Registry the trust gate reads: its declared name and its source. */
export type TrustedRegistryInput = Pick<Registry, "name" | "source">;

/** Why a Registry is trusted. */
type TrustReason = "first-party" | "user-config" | "flag" | "lockfile" | "prompt";

/** The outcome of the trust gate for one Registry. */
export interface TrustDecision {
  /** The Registry name. */
  readonly registry: string;
  /** The Registry source as the Lockfile records it, pinned SHA included. */
  readonly source: string;
  readonly via: TrustReason;
  /** Whether the command records `registries.<name>.trusted: true` in the Lockfile it writes. */
  readonly lockfileTrusted: boolean;
}

/** Asks the user one question and resolves with the raw answer. */
type TrustPrompt = (question: string) => Promise<string>;

interface EnsureTrustedOptions {
  /** Every `--trust <name|source>` value of the command. */
  readonly trustFlags: readonly string[];
  /**
   * The Lockfile already on disk in the Project, when it has one. Never pass a Lockfile fetched
   * from elsewhere (`create --from <url>`): its `trusted` flags are not the user's decision.
   */
  readonly lockfile?: Pick<Lockfile, "registries">;
  /** Whether an untrusted Registry may be asked about; see {@link isNonInteractive}. */
  readonly interactive: boolean;
  /** Asks the trust question; without it an untrusted Registry cannot be asked about. */
  readonly prompt?: TrustPrompt;
  /** The user config allowlist; read from {@link env} when absent. */
  readonly userConfig?: UserConfig;
  /** The environment the user config path is derived from; `process.env` by default. */
  readonly env?: TrustEnvironment;
}

const agentVariables = [
  "CI",
  "CLAUDECODE",
  "CURSOR_AGENT",
  "CODEX_SANDBOX",
  "GEMINI_CLI",
  "AOKIT_AGENT",
] as const;

const sourceLikePattern = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|@[^=\s]+=)/;

/**
 * Whether the run cannot ask for trust: `--yes`, no TTY, or a detected CI or coding agent. `--yes`
 * only makes the run non-interactive; it never grants trust.
 */
export function isNonInteractive(input: {
  readonly yes: boolean;
  readonly env: TrustEnvironment;
  readonly isTTY: boolean;
}): boolean {
  if (input.yes || !input.isTTY) {
    return true;
  }
  return agentVariables.some((variable) => {
    const value = input.env[variable];
    return value !== undefined && value !== "";
  });
}

function isFirstParty(registry: TrustedRegistryInput): boolean {
  return registry.source.kind === "bundled" || registry.source.kind === "local";
}

/**
 * Whether `name` is bound to a source other than this Registry's: another Registry of the run
 * declares it with another source, the Lockfile records it with another host or repository, or the
 * user config allowed it for another one. A bare `--trust <name>` then does not pass.
 */
function isNameContested(
  registry: TrustedRegistryInput,
  registries: readonly TrustedRegistryInput[],
  options: EnsureTrustedOptions,
  userConfig: UserConfig,
): boolean {
  const identity = sourceIdentity(registry.source);
  const rival = registries.some(
    (other) => other.name === registry.name && sourceIdentity(other.source) !== identity,
  );
  const locked = options.lockfile?.registries[registry.name];
  const lockedElsewhere = locked !== undefined && sourceStringIdentity(locked.source) !== identity;
  const allowedElsewhere = userConfig.trustedRegistries.some(
    (entry) => entry.name === registry.name && sourceStringIdentity(entry.source) !== identity,
  );
  return rival || lockedElsewhere || allowedElsewhere;
}

function matchesTrustFlag(
  flag: string,
  registry: TrustedRegistryInput,
  nameContested: boolean,
): boolean {
  if (sourceLikePattern.test(flag)) {
    return sourceStringIdentity(flag) === sourceIdentity(registry.source);
  }
  return flag === registry.name && !nameContested;
}

function allowedByUserConfig(registry: TrustedRegistryInput, userConfig: UserConfig): boolean {
  const identity = sourceIdentity(registry.source);
  return userConfig.trustedRegistries.some(
    (entry) => entry.name === registry.name && sourceStringIdentity(entry.source) === identity,
  );
}

function trustedByLockfile(
  registry: TrustedRegistryInput,
  lockfile: Pick<Lockfile, "registries"> | undefined,
): boolean {
  const entry = lockfile?.registries[registry.name];
  return (
    entry?.trusted === true &&
    sourceStringIdentity(entry.source) === sourceIdentity(registry.source)
  );
}

function trustFlagFor(registry: TrustedRegistryInput, nameContested: boolean): string {
  return `--trust ${nameContested ? formatRegistrySource(registry.source) : registry.name}`;
}

function untrusted(
  registry: TrustedRegistryInput,
  nameContested: boolean,
  configPath: string,
): RegistryError {
  const source = formatRegistrySource(registry.source);
  const flag = trustFlagFor(registry, nameContested);
  return new RegistryError(
    "REGISTRY_UNTRUSTED",
    `Registry "${registry.name}" (${source}) is not trusted. Rerun with \`${flag}\` to trust it.`,
    `Pass \`${flag}\`, add { "name": "${registry.name}", "source": "${source}" } to trustedRegistries in ${configPath}, or run the command in a terminal and answer the trust prompt. \`--yes\` never grants trust.`,
    { registry: registry.name, path: source },
  );
}

function trustQuestion(registry: TrustedRegistryInput): string {
  const source = formatRegistrySource(registry.source);
  return [
    `Registry "${registry.name}" (${source}) is not a Trusted Registry.`,
    "Trusting it lets aokit fetch its Modules and write their files into this Project.",
    "Trust it? [y]es for this Project, [a]lways for every Project, [N]o: ",
  ].join("\n");
}

function rejectPrompt(): Promise<string> {
  return Promise.resolve("no");
}

function parseAnswer(answer: string): "yes" | "always" | "no" {
  const normalized = answer.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") {
    return "yes";
  }
  return normalized === "a" || normalized === "always" ? "always" : "no";
}

function nonPromptReason(
  registry: TrustedRegistryInput,
  options: EnsureTrustedOptions,
  userConfig: UserConfig,
  nameContested: boolean,
): TrustReason | undefined {
  if (isFirstParty(registry)) {
    return "first-party";
  }
  if (options.trustFlags.some((flag) => matchesTrustFlag(flag, registry, nameContested))) {
    return "flag";
  }
  if (trustedByLockfile(registry, options.lockfile)) {
    return "lockfile";
  }
  return allowedByUserConfig(registry, userConfig) ? "user-config" : undefined;
}

async function askForTrust(
  registry: TrustedRegistryInput,
  nameContested: boolean,
  prompt: TrustPrompt,
  env: TrustEnvironment,
): Promise<TrustReason> {
  const answer = parseAnswer(await prompt(trustQuestion(registry)));
  if (answer === "no") {
    throw untrusted(registry, nameContested, userConfigPath(env));
  }
  if (answer === "always") {
    await addTrustedRegistry(
      { name: registry.name, source: formatRegistrySource(registry.source) },
      env,
    );
  }
  return "prompt";
}

/**
 * The trust gate. `official` (bundled) and `local` Registries are trusted; any other is trusted by
 * a matching `--trust`, its Lockfile `trusted` flag, the user config allowlist, or, in an
 * interactive run, a prompt answered `yes` or `always` (`always` adds it to the user config).
 * Trust is bound to the source's host or repository, so a changed one is asked about again.
 * Otherwise it throws a `REGISTRY_UNTRUSTED` RegistryError showing the exact `--trust` form.
 */
export async function ensureTrusted(
  registries: readonly TrustedRegistryInput[],
  options: EnsureTrustedOptions,
): Promise<TrustDecision[]> {
  const env = options.env ?? process.env;
  const userConfig =
    options.userConfig ??
    (registries.every(isFirstParty) ? { trustedRegistries: [] } : await loadUserConfig(env));
  const pending = registries.map((registry) => {
    const nameContested = isNameContested(registry, registries, options, userConfig);
    return {
      registry,
      nameContested,
      via: nonPromptReason(registry, options, userConfig, nameContested),
    };
  });
  const firstUntrusted = pending.find((entry) => entry.via === undefined);
  if (firstUntrusted !== undefined && (!options.interactive || options.prompt === undefined)) {
    throw untrusted(firstUntrusted.registry, firstUntrusted.nameContested, userConfigPath(env));
  }
  const decisions: TrustDecision[] = [];
  const prompt = options.prompt;
  for (const entry of pending) {
    const via =
      entry.via ??
      // oxlint-disable-next-line eslint/no-await-in-loop -- one trust prompt at a time, in order
      (await askForTrust(entry.registry, entry.nameContested, prompt ?? rejectPrompt, env));
    decisions.push({
      registry: entry.registry.name,
      source: formatRegistrySource(entry.registry.source),
      via,
      lockfileTrusted: via !== "first-party",
    });
  }
  return decisions;
}
