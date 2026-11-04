import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserConfig } from "../../src/config/user-config.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { toAokitError } from "../../src/project/errors.ts";
import { AokitError } from "../../src/cli/envelope.ts";
import { RegistryError } from "../../src/registry/errors.ts";
import {
  expandNamespaceRequest,
  expandTemplate,
  loadNamespaceEnvironment,
  parseEnvFile,
  resolveNamespace,
  templateVariables,
} from "../../src/registry/namespace.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const acmeConfig: UserConfig = {
  trustedRegistries: [],
  registries: {
    "@acme": {
      url: "https://registry.acme.dev/r/{name}.json",
      headers: { Authorization: "Bearer ${ACME_REGISTRY_TOKEN}" },
    },
  },
};

function thrownBy(action: () => unknown): RegistryError {
  try {
    action();
  } catch (error) {
    if (error instanceof RegistryError) return error;
    throw error;
  }
  throw new Error("expected a RegistryError");
}

test("a configured Namespace resolves @acme/button to its URL with {name} = button", () => {
  const target = resolveNamespace("@acme/button", acmeConfig, { ACME_REGISTRY_TOKEN: "t" });
  expect(target).toEqual({
    namespace: "@acme",
    item: "button",
    urlTemplate: "https://registry.acme.dev/r/button.json",
    headers: { Authorization: "Bearer ${ACME_REGISTRY_TOKEN}" },
  });
});

test("without a user config @shadcn/button resolves to the built-in URL", () => {
  const target = resolveNamespace("@shadcn/button", { trustedRegistries: [] }, {});
  expect(target.urlTemplate).toBe("https://ui.shadcn.com/r/button.json");
  expect(target.headers).toEqual({});
});

test("a user config entry for @shadcn replaces the built-in one", () => {
  const config: UserConfig = {
    trustedRegistries: [],
    registries: { "@shadcn": { url: "https://mirror.test/{name}.json" } },
  };
  expect(resolveNamespace("@shadcn/card", config, {}).urlTemplate).toBe(
    "https://mirror.test/card.json",
  );
});

test("an unknown Namespace fails naming it", () => {
  const failure = thrownBy(() => resolveNamespace("@nope/button", acmeConfig, {}));
  expect(failure.code).toBe("REGISTRY_NOT_FOUND");
  expect(failure.message).toContain("@nope");
});

test("an address that is not @namespace/item is refused", () => {
  for (const address of ["button", "@acme", "@acme/../x", "@acme/a/b", "acme/button"]) {
    expect(thrownBy(() => resolveNamespace(address, acmeConfig, {})).code).toBe(
      "REGISTRY_SOURCE_UNSUPPORTED",
    );
  }
});

test("an unset variable fails with REGISTRY_ENV_UNSET naming it, at exit 2", () => {
  const failure = thrownBy(() => resolveNamespace("@acme/button", acmeConfig, {}));
  expect(failure.code).toBe("REGISTRY_ENV_UNSET");
  expect(failure.message).toContain("ACME_REGISTRY_TOKEN");
  expect(failure.data.variable).toBe("ACME_REGISTRY_TOKEN");
  const coded = toAokitError(failure);
  if (!(coded instanceof AokitError)) throw new Error("expected an AokitError");
  expect(coded.code).toBe("REGISTRY_ENV_UNSET");
  expect(exitCodeForErrorCode(coded.code)).toBe(2);
});

test("an unset variable in the url fails the same way", () => {
  const config: UserConfig = {
    trustedRegistries: [],
    registries: { "@acme": { url: "https://${ACME_HOST}/r/{name}.json" } },
  };
  expect(thrownBy(() => resolveNamespace("@acme/button", config, {})).data.variable).toBe(
    "ACME_HOST",
  );
});

test("expandTemplate replaces every placeholder and lists them in order", () => {
  const env = { A: "1", B: "2" };
  expect(expandTemplate("${A}-${B}-${A}", env)).toBe("1-2-1");
  expect(templateVariables("${A}-${B}-${A}")).toEqual(["A", "B"]);
  expect(expandTemplate("no placeholders $A {B}", {})).toBe("no placeholders $A {B}");
  expect(expandTemplate("${EMPTY}", { EMPTY: "" })).toBe("");
});

test("expanding a target gives the request but the target keeps the placeholders", () => {
  const env = { ACME_REGISTRY_TOKEN: "s3cr3t-token" };
  const target = resolveNamespace("@acme/button", acmeConfig, env);
  expect(expandNamespaceRequest(target, env)).toEqual({
    url: "https://registry.acme.dev/r/button.json",
    headers: { Authorization: "Bearer s3cr3t-token" },
  });
  expect(JSON.stringify(target)).not.toContain("s3cr3t-token");
});

test("an expanded url that is not https names the placeholder url, never the value", () => {
  const config: UserConfig = {
    trustedRegistries: [],
    registries: { "@acme": { url: "${ACME_URL}/{name}.json" } },
  };
  const env = { ACME_URL: "http://example.test/s3cr3t-token" };
  const target = resolveNamespace("@acme/button", config, env);
  const failure = thrownBy(() => expandNamespaceRequest(target, env));
  expect(failure.code).toBe("REGISTRY_SOURCE_UNSUPPORTED");
  expect(failure.message).toContain("${ACME_URL}/button.json");
  expect(
    JSON.stringify({ ...failure.data, message: failure.message, fix: failure.fix }),
  ).not.toContain("s3cr3t-token");
});

test("a .env file parses comments, export, quotes and inline comments", () => {
  expect(
    parseEnvFile(
      [
        "# a comment",
        "",
        "export A=1",
        'B="two words"',
        "C='single'",
        "D=plain # trailing",
        "not a line",
      ].join("\n"),
    ),
  ).toEqual({ A: "1", B: "two words", C: "single", D: "plain" });
});

test("the Namespace environment is .env overlaid by the process environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aokit-namespace-env-"));
  directories.push(directory);
  expect(await loadNamespaceEnvironment(directory, { A: "env" })).toEqual({ A: "env" });
  await writeFile(join(directory, ".env"), "ACME_REGISTRY_TOKEN=from-file\nA=file\n");
  const env = await loadNamespaceEnvironment(directory, { A: "env", B: undefined });
  expect(env).toEqual({ ACME_REGISTRY_TOKEN: "from-file", A: "env" });
  expect(resolveNamespace("@acme/button", acmeConfig, env).namespace).toBe("@acme");
});
