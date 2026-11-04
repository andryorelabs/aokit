import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import {
  addTrustedRegistry,
  loadUserConfig,
  userConfigPath,
} from "../../src/config/user-config.ts";

let configHome: string;
let env: Record<string, string>;

beforeEach(async () => {
  configHome = await mkdtemp(join(tmpdir(), "aokit-config-"));
  env = { XDG_CONFIG_HOME: configHome, HOME: configHome };
});

afterEach(async () => {
  await rm(configHome, { recursive: true, force: true });
});

async function writeConfig(content: string): Promise<void> {
  await mkdir(join(configHome, "aokit"), { recursive: true });
  await writeFile(join(configHome, "aokit", "config.json"), content);
}

test("the user config lives at $XDG_CONFIG_HOME/aokit/config.json", () => {
  expect(userConfigPath(env)).toBe(join(configHome, "aokit", "config.json"));
});

test("a missing user config is an empty allowlist", async () => {
  expect(await loadUserConfig(env)).toEqual({ trustedRegistries: [] });
});

test("the user config lists its trusted Registries", async () => {
  await writeConfig(
    JSON.stringify({ trustedRegistries: [{ name: "acme", source: "https://r.test" }] }),
  );
  expect(await loadUserConfig(env)).toEqual({
    trustedRegistries: [{ name: "acme", source: "https://r.test" }],
  });
});

test("a user config without trustedRegistries is an empty allowlist", async () => {
  await writeConfig("{}");
  expect((await loadUserConfig(env)).trustedRegistries).toEqual([]);
});

test("an invalid user config fails with INVALID_INPUT naming the file", async () => {
  await writeConfig(JSON.stringify({ trustedRegistries: [{ name: "acme" }] }));
  const failure = await configFailure();
  expect(failure.code).toBe("INVALID_INPUT");
  expect(failure.message).toContain(userConfigPath(env));
});

test("a user config that is not JSON fails with INVALID_INPUT", async () => {
  await writeConfig("{ not json");
  expect((await configFailure()).code).toBe("INVALID_INPUT");
});

async function configFailure(): Promise<AokitError> {
  const failure = await loadUserConfig(env).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(failure instanceof AokitError)) {
    throw new Error(`expected an AokitError, got ${String(failure)}`);
  }
  return failure;
}

test("adding a trusted Registry creates the config and keeps other keys", async () => {
  await addTrustedRegistry({ name: "acme", source: "https://r.test" }, env);
  await addTrustedRegistry({ name: "acme", source: "https://r.test" }, env);
  expect(await loadUserConfig(env)).toEqual({
    trustedRegistries: [{ name: "acme", source: "https://r.test" }],
  });

  await writeConfig(
    JSON.stringify({ theme: "dark", trustedRegistries: [{ name: "a", source: "github:a/b" }] }),
  );
  await addTrustedRegistry({ name: "acme", source: "https://r.test" }, env);
  const written = JSON.parse(await readFile(userConfigPath(env), "utf8")) as unknown;
  expect(written).toEqual({
    theme: "dark",
    trustedRegistries: [
      { name: "a", source: "github:a/b" },
      { name: "acme", source: "https://r.test" },
    ],
  });
});

const acmeRegistries = {
  "@acme": {
    url: "https://registry.acme.dev/r/{name}.json",
    headers: { Authorization: "Bearer ${ACME_REGISTRY_TOKEN}" },
  },
};

test("the user config reads registries Namespaces with their placeholders", async () => {
  await writeConfig(JSON.stringify({ registries: acmeRegistries }));
  expect(await loadUserConfig(env)).toEqual({
    trustedRegistries: [],
    registries: acmeRegistries,
  });
});

test("a Namespace url without {name} is invalid", async () => {
  await writeConfig(JSON.stringify({ registries: { "@acme": { url: "https://r.test/x.json" } } }));
  const failure = await configFailure();
  expect(failure.code).toBe("INVALID_INPUT");
  expect(failure.message).toContain("{name}");
});

test("a Namespace not named like @acme is invalid", async () => {
  await writeConfig(
    JSON.stringify({ registries: { acme: { url: "https://r.test/{name}.json" } } }),
  );
  expect((await configFailure()).code).toBe("INVALID_INPUT");
});

test("a Namespace with an unknown key or a non-string header is invalid", async () => {
  await writeConfig(
    JSON.stringify({ registries: { "@acme": { url: "https://r.test/{name}.json", token: "x" } } }),
  );
  expect((await configFailure()).code).toBe("INVALID_INPUT");
  await writeConfig(
    JSON.stringify({
      registries: { "@acme": { url: "https://r.test/{name}.json", headers: { A: 1 } } },
    }),
  );
  expect((await configFailure()).code).toBe("INVALID_INPUT");
});

test("adding a trusted Registry keeps registries and unknown keys as written", async () => {
  await writeConfig(JSON.stringify({ theme: "dark", registries: acmeRegistries }));
  await addTrustedRegistry({ name: "@acme", source: "https://registry.acme.dev/r" }, env);
  const written = JSON.parse(await readFile(userConfigPath(env), "utf8")) as unknown;
  expect(written).toEqual({
    theme: "dark",
    registries: acmeRegistries,
    trustedRegistries: [{ name: "@acme", source: "https://registry.acme.dev/r" }],
  });
});
