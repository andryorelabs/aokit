import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { loadUserConfig } from "../../src/config/user-config.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";
import { toAokitError } from "../../src/project/errors.ts";
import { RegistryError } from "../../src/registry/errors.ts";
import type { RegistrySource } from "../../src/registry/source.ts";
import {
  ensureTrusted,
  isNonInteractive,
  type TrustedRegistryInput,
} from "../../src/trust/gate.ts";

let configHome: string;
let env: Record<string, string>;

beforeEach(async () => {
  configHome = await mkdtemp(join(tmpdir(), "aokit-trust-"));
  env = { XDG_CONFIG_HOME: configHome, HOME: configHome };
});

afterEach(async () => {
  await rm(configHome, { recursive: true, force: true });
});

function registry(name: string, source: RegistrySource): TrustedRegistryInput {
  return { name, source };
}

const remote = registry("acme", { kind: "url", url: "https://r.test" });
const github = registry("mods", {
  kind: "github",
  owner: "acme",
  repo: "mods",
  ref: "0123456789abcdef0123456789abcdef01234567",
});

function lockfileWith(registries: Lockfile["registries"]): Pick<Lockfile, "registries"> {
  return { registries };
}

function lockEntry(source: string, trusted?: boolean): Lockfile["registries"][string] {
  return {
    source,
    release: "2026.11.0",
    minCliVersion: "0.1.0",
    ...(trusted === undefined ? {} : { trusted }),
  };
}

async function untrustedFailure(promise: Promise<unknown>): Promise<RegistryError> {
  const failure = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(failure instanceof RegistryError)) {
    throw new Error(`expected a RegistryError, got ${String(failure)}`);
  }
  expect(failure.code).toBe("REGISTRY_UNTRUSTED");
  return failure;
}

function failingPrompt(): Promise<string> {
  throw new Error("the prompt must not be shown");
}

test("official and local Registries are trusted without asking", async () => {
  const decisions = await ensureTrusted(
    [
      registry("official", { kind: "bundled", path: "/cli/registry" }),
      registry("mine", { kind: "local", path: "/work/registry" }),
    ],
    { trustFlags: [], interactive: false, env, prompt: failingPrompt },
  );
  expect(
    decisions.map((decision) => [decision.registry, decision.via, decision.lockfileTrusted]),
  ).toEqual([
    ["official", "first-party", false],
    ["mine", "first-party", false],
  ]);
});

test("S10: an untrusted Registry with --yes and an empty config exits 5 with the --trust form", async () => {
  const failure = await untrustedFailure(
    ensureTrusted([remote], {
      trustFlags: [],
      interactive: !isNonInteractive({ yes: true, env: {}, isTTY: true }),
      env,
      prompt: failingPrompt,
    }),
  );
  expect(failure.message).toContain("--trust acme");
  expect(failure.message).toContain("https://r.test");
  expect(failure.data).toEqual({ registry: "acme", path: "https://r.test" });
  const coded = toAokitError(failure);
  if (!(coded instanceof AokitError)) {
    throw new Error("expected an AokitError");
  }
  expect(coded.code).toBe("REGISTRY_UNTRUSTED");
  expect(exitCodeForErrorCode(coded.code)).toBe(5);
});

test("S10: --trust <source> trusts the Registry and asks the Lockfile to record trusted", async () => {
  const decisions = await ensureTrusted([remote], {
    trustFlags: ["https://r.test"],
    interactive: false,
    env,
    prompt: failingPrompt,
  });
  expect(decisions).toEqual([
    { registry: "acme", source: "https://r.test", via: "flag", lockfileTrusted: true },
  ]);
});

test("--trust <name> trusts the Registry declaring that name", async () => {
  const decisions = await ensureTrusted([remote, github], {
    trustFlags: ["mods", "acme"],
    interactive: false,
    env,
  });
  expect(decisions.map((decision) => decision.via)).toEqual(["flag", "flag"]);
});

test("a --trust value naming another Registry does not trust this one", async () => {
  await untrustedFailure(
    ensureTrusted([remote], {
      trustFlags: ["other", "https://other.test"],
      interactive: false,
      env,
    }),
  );
});

test("Review Focus: a spoofed name with a different source does not pass --trust <name>", async () => {
  const spoof = registry("acme", { kind: "url", url: "https://evil.test" });
  const lockfile = lockfileWith({ acme: lockEntry("https://r.test", true) });
  const failure = await untrustedFailure(
    ensureTrusted([spoof], { trustFlags: ["acme"], lockfile, interactive: false, env }),
  );
  expect(failure.message).toContain("--trust https://evil.test");

  await untrustedFailure(
    ensureTrusted([remote, spoof], { trustFlags: ["acme"], interactive: false, env }),
  );

  const bySource = await ensureTrusted([spoof], {
    trustFlags: ["https://evil.test"],
    lockfile,
    interactive: false,
    env,
  });
  expect(bySource[0]?.via).toBe("flag");
});

test("Review Focus: a --trust source with a different host or repository does not pass", async () => {
  await untrustedFailure(
    ensureTrusted([remote], { trustFlags: ["https://r.test.evil.test"], interactive: false, env }),
  );
  await untrustedFailure(
    ensureTrusted([github], { trustFlags: ["github:acme/other#main"], interactive: false, env }),
  );
  const moved = await ensureTrusted([github], {
    trustFlags: ["github:acme/mods#main"],
    interactive: false,
    env,
  });
  expect(moved[0]?.via).toBe("flag");
});

test("--yes never grants trust", () => {
  expect(isNonInteractive({ yes: true, env: {}, isTTY: true })).toBe(true);
});

test("no TTY or a detected coding agent is non-interactive", () => {
  expect(isNonInteractive({ yes: false, env: {}, isTTY: false })).toBe(true);
  expect(isNonInteractive({ yes: false, env: {}, isTTY: true })).toBe(false);
  for (const variable of [
    "CI",
    "CLAUDECODE",
    "CURSOR_AGENT",
    "CODEX_SANDBOX",
    "GEMINI_CLI",
    "AOKIT_AGENT",
  ]) {
    expect(isNonInteractive({ yes: false, env: { [variable]: "1" }, isTTY: true })).toBe(true);
  }
  expect(isNonInteractive({ yes: false, env: { CI: "" }, isTTY: true })).toBe(false);
});

test("the user config allowlist trusts a Registry by name and source", async () => {
  const userConfig = { trustedRegistries: [{ name: "mods", source: "github:acme/mods#main" }] };
  const decisions = await ensureTrusted([github], {
    trustFlags: [],
    interactive: false,
    env,
    userConfig,
  });
  expect(decisions[0]).toMatchObject({ via: "user-config", lockfileTrusted: true });
});

test("the user config is read from $XDG_CONFIG_HOME when not given", async () => {
  await Bun.write(
    join(configHome, "aokit", "config.json"),
    JSON.stringify({ trustedRegistries: [{ name: "acme", source: "https://r.test/" }] }),
  );
  const decisions = await ensureTrusted([remote], { trustFlags: [], interactive: false, env });
  expect(decisions[0]?.via).toBe("user-config");
});

test("Review Focus: trust is asked again when the allowed source changes host or repository", async () => {
  const userConfig = {
    trustedRegistries: [
      { name: "acme", source: "https://other.test" },
      { name: "mods", source: "github:acme/forked-mods" },
    ],
  };
  await untrustedFailure(
    ensureTrusted([remote], { trustFlags: [], interactive: false, env, userConfig }),
  );
  await untrustedFailure(
    ensureTrusted([github], { trustFlags: [], interactive: false, env, userConfig }),
  );
});

test("the Lockfile trusted flag trusts the Registry it records", async () => {
  const lockfile = lockfileWith({
    acme: lockEntry("https://r.test", true),
    mods: lockEntry("github:acme/mods#fedcba9876543210fedcba9876543210fedcba98", true),
  });
  const decisions = await ensureTrusted([remote, github], {
    trustFlags: [],
    lockfile,
    interactive: false,
    env,
  });
  expect(decisions.map((decision) => decision.via)).toEqual(["lockfile", "lockfile"]);
});

test("a Lockfile entry without trusted does not trust the Registry", async () => {
  const lockfile = lockfileWith({ acme: lockEntry("https://r.test") });
  await untrustedFailure(
    ensureTrusted([remote], { trustFlags: [], lockfile, interactive: false, env }),
  );
});

test("Review Focus: a Lockfile-trusted Registry whose host or repository changed is asked again", async () => {
  const lockfile = lockfileWith({
    acme: lockEntry("https://old.test", true),
    mods: lockEntry("github:other/mods#fedcba9876543210fedcba9876543210fedcba98", true),
  });
  const questions: string[] = [];
  const decisions = await ensureTrusted([remote, github], {
    trustFlags: [],
    lockfile,
    interactive: true,
    env,
    prompt: (question) => {
      questions.push(question);
      return Promise.resolve("yes");
    },
  });
  expect(questions).toHaveLength(2);
  expect(questions[0]).toContain("https://r.test");
  expect(questions[1]).toContain("github:acme/mods#0123456789abcdef0123456789abcdef01234567");
  expect(decisions.map((decision) => decision.via)).toEqual(["prompt", "prompt"]);
  await untrustedFailure(
    ensureTrusted([remote], { trustFlags: [], lockfile, interactive: false, env }),
  );
});

test("a prompt answered yes trusts the Registry for this Project only", async () => {
  const decisions = await ensureTrusted([remote], {
    trustFlags: [],
    interactive: true,
    env,
    prompt: () => Promise.resolve("y"),
  });
  expect(decisions[0]).toMatchObject({ via: "prompt", lockfileTrusted: true });
  expect(await loadUserConfig(env)).toEqual({ trustedRegistries: [] });
});

test("a prompt answered no fails with REGISTRY_UNTRUSTED", async () => {
  for (const answer of ["no", "", "maybe"]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- fixed, ordered output
    await untrustedFailure(
      ensureTrusted([remote], {
        trustFlags: [],
        interactive: true,
        env,
        prompt: () => Promise.resolve(answer),
      }),
    );
  }
});

test("a prompt answered always writes the user config, so the next run does not ask", async () => {
  await ensureTrusted([remote], {
    trustFlags: [],
    interactive: true,
    env,
    prompt: () => Promise.resolve("always"),
  });
  expect(await loadUserConfig(env)).toEqual({
    trustedRegistries: [{ name: "acme", source: "https://r.test" }],
  });
  const next = await ensureTrusted([remote], {
    trustFlags: [],
    interactive: false,
    env,
    prompt: failingPrompt,
  });
  expect(next[0]?.via).toBe("user-config");
});

test("an interactive run does not ask for a Registry already trusted", async () => {
  const decisions = await ensureTrusted([remote], {
    trustFlags: ["acme"],
    interactive: true,
    env,
    prompt: failingPrompt,
  });
  expect(decisions[0]?.via).toBe("flag");
});
