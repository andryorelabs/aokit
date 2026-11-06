import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { errorPayloadFrom } from "../../src/cli/envelope.ts";
import { addTrustedRegistry, type UserConfig } from "../../src/config/user-config.ts";
import { toAokitError } from "../../src/project/errors.ts";
import { RegistryError } from "../../src/registry/errors.ts";
import { expandNamespaceRequest, resolveNamespace } from "../../src/registry/namespace.ts";
import { urlTransport } from "../../src/registry/remote.ts";
import { type ServedRegistry, serveRegistry } from "./served-registry.ts";

const token = "s3cr3t-acme-token";
const itemJson = `${JSON.stringify({ name: "button", type: "registry:ui" })}\n`;
const servers: ServedRegistry[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aokit-headers-"));
  directories.push(directory);
  return directory;
}

async function servedItems(): Promise<ServedRegistry> {
  const root = await temporaryDirectory();
  await mkdir(join(root, "r"), { recursive: true });
  await writeFile(join(root, "r", "button.json"), itemJson);
  const server = serveRegistry(root);
  servers.push(server);
  return server;
}

function acmeConfig(baseUrl: string): UserConfig {
  return {
    trustedRegistries: [],
    registries: {
      "@acme": {
        url: `${baseUrl}/r/{name}.json`,
        headers: { Authorization: "Bearer ${ACME_REGISTRY_TOKEN}" },
      },
    },
  };
}

/** Reads `@acme/button` the way a command would: resolve, expand at request time, fetch. */
async function readAcmeButton(
  config: UserConfig,
  env: Record<string, string | undefined>,
): Promise<string | undefined> {
  const target = resolveNamespace("@acme/button", config, env);
  const request = expandNamespaceRequest(target, env);
  const transport = urlTransport(dirname(request.url), fetch, {
    headers: request.headers,
    displayBase: dirname(target.urlTemplate),
  });
  return transport.read("button.json");
}

async function rejection(action: () => Promise<unknown>): Promise<RegistryError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RegistryError) return error;
    throw error;
  }
  throw new Error("expected a RegistryError");
}

test("a Namespace request sends its expanded headers to its own origin", async () => {
  const server = await servedItems();
  const text = await readAcmeButton(acmeConfig(server.url), { ACME_REGISTRY_TOKEN: token });
  expect(text).toBe(itemJson);
  expect(server.received).toHaveLength(1);
  expect(server.received[0]?.headers.authorization).toBe(`Bearer ${token}`);
});

test("a redirect to another host drops the Authorization header", async () => {
  const origin = await servedItems();
  const mirror = await servedItems();
  origin.redirects.set("r/button.json", `${mirror.url}/r/button.json`);
  const text = await readAcmeButton(acmeConfig(origin.url), { ACME_REGISTRY_TOKEN: token });
  expect(text).toBe(itemJson);
  expect(origin.received[0]?.headers.authorization).toBe(`Bearer ${token}`);
  expect(mirror.received).toHaveLength(1);
  expect(mirror.received[0]?.headers.authorization).toBeUndefined();
});

test("the same host on a different port is another origin", async () => {
  const origin = await servedItems();
  const otherPort = await servedItems();
  expect(new URL(origin.url).hostname).toBe(new URL(otherPort.url).hostname);
  origin.redirects.set("r/button.json", `${otherPort.url}/r/button.json`);
  await readAcmeButton(acmeConfig(origin.url), { ACME_REGISTRY_TOKEN: token });
  expect(otherPort.received[0]?.headers.authorization).toBeUndefined();
});

test("another hostname for the same server is another origin", async () => {
  const origin = await servedItems();
  const otherHost = origin.url.replace("127.0.0.1", "localhost");
  origin.redirects.set("r/old.json", `${otherHost}/r/button.json`);
  const transport = urlTransport(`${origin.url}/r`, fetch, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await transport.read("old.json")).toBe(itemJson);
  expect(origin.received.map((request) => request.path)).toEqual(["r/old.json", "r/button.json"]);
  expect(origin.received[0]?.headers.authorization).toBe(`Bearer ${token}`);
  expect(origin.received[1]?.headers.authorization).toBeUndefined();
});

test("a same-origin redirect keeps the headers", async () => {
  const origin = await servedItems();
  origin.redirects.set("r/old.json", `${origin.url}/r/button.json`);
  const transport = urlTransport(`${origin.url}/r`, fetch, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await transport.read("old.json")).toBe(itemJson);
  expect(origin.received.map((request) => request.headers.authorization)).toEqual([
    `Bearer ${token}`,
    `Bearer ${token}`,
  ]);
});

test("a chain that leaves the origin and returns to it does not get the headers back", async () => {
  const origin = await servedItems();
  const mirror = await servedItems();
  origin.redirects.set("r/button.json", `${mirror.url}/r/bounce.json`);
  mirror.redirects.set("r/bounce.json", `${origin.url}/r/final.json`);
  const transport = urlTransport(`${origin.url}/r`, fetch, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await transport.read("button.json");
  expect(origin.received.map((request) => request.path)).toEqual(["r/button.json", "r/final.json"]);
  expect(origin.received[1]?.headers.authorization).toBeUndefined();
  expect(mirror.received[0]?.headers.authorization).toBeUndefined();
});

test("an http to https redirect on the same host and port is another origin", async () => {
  const seen: { url: string; authorization: string | null }[] = [];
  const recordingFetch: typeof fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      seen.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      return Promise.resolve(
        url.startsWith("http:")
          ? new Response(null, {
              status: 302,
              headers: { location: url.replace("http:", "https:") },
            })
          : new Response(itemJson),
      );
    },
    { preconnect: fetch.preconnect },
  );
  const transport = urlTransport("http://127.0.0.1:4873/r", recordingFetch, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(await transport.read("button.json")).toBe(itemJson);
  expect(seen).toEqual([
    { url: "http://127.0.0.1:4873/r/button.json", authorization: `Bearer ${token}` },
    { url: "https://127.0.0.1:4873/r/button.json", authorization: null },
  ]);
});

test("an unset variable fails before any request of a redirect chain is sent", async () => {
  const origin = await servedItems();
  const mirror = await servedItems();
  origin.redirects.set("r/button.json", `${mirror.url}/r/button.json`);
  const failure = await rejection(() => readAcmeButton(acmeConfig(origin.url), {}));
  expect(failure.code).toBe("REGISTRY_ENV_UNSET");
  expect(failure.message).toContain("ACME_REGISTRY_TOKEN");
  expect(origin.received).toEqual([]);
  expect(mirror.received).toEqual([]);
});

test("the expanded token never reaches an error, the --json envelope or a written file", async () => {
  const origin = await servedItems();
  const env = { ACME_REGISTRY_TOKEN: token, ACME_PATH: `r-${token}` };
  const config: UserConfig = {
    trustedRegistries: [],
    registries: {
      "@acme": {
        url: `${origin.url}/\${ACME_PATH}/{name}.json`,
        headers: { Authorization: "Bearer ${ACME_REGISTRY_TOKEN}" },
      },
    },
  };
  origin.failPaths.add(`r-${token}/button.json`);
  const failure = await rejection(() => readAcmeButton(config, env));
  expect(failure.code).toBe("REGISTRY_FETCH_FAILED");
  expect(failure.message).toContain("${ACME_PATH}");
  const envelope = JSON.stringify({
    ok: false,
    data: null,
    error: errorPayloadFrom(toAokitError(failure)),
  });
  expect(envelope).not.toContain(token);
  expect(`${failure.message}\n${failure.fix}\n${JSON.stringify(failure.data)}`).not.toContain(
    token,
  );

  const target = resolveNamespace("@acme/button", config, env);
  expect(JSON.stringify(target)).not.toContain(token);

  const configHome = await temporaryDirectory();
  const configPath = join(configHome, "aokit", "config.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({ registries: config.registries }));
  await addTrustedRegistry(
    { name: "@acme", source: target.urlTemplate },
    { XDG_CONFIG_HOME: configHome },
  );
  const written = await readFile(configPath, "utf8");
  expect(written).toContain("${ACME_REGISTRY_TOKEN}");
  expect(written).not.toContain(token);
});

test("a header value is redacted from a fetch failure message", async () => {
  const failingFetch: typeof fetch = Object.assign(
    () => Promise.reject(new Error(`socket closed while sending Bearer ${token}`)),
    { preconnect: fetch.preconnect },
  );
  const transport = urlTransport("https://r.test/r", failingFetch, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const failure = await rejection(() => transport.read("button.json"));
  expect(failure.code).toBe("REGISTRY_FETCH_FAILED");
  expect(failure.message).not.toContain(token);
  expect(failure.message).toContain("[redacted]");
});

test("the bare token and not a short header value is redacted from a failure message", async () => {
  const failingFetch: typeof fetch = Object.assign(
    () => Promise.reject(new Error(`rejected token ${token} for version 1`)),
    { preconnect: fetch.preconnect },
  );
  const transport = urlTransport("https://r.test/r", failingFetch, {
    headers: { Authorization: `Bearer ${token}`, "X-Version": "1" },
  });
  const failure = await rejection(() => transport.read("button.json"));
  expect(failure.message).not.toContain(token);
  expect(failure.message).toContain("for version 1");
});

test("without headers the transport sends none, as before", async () => {
  const origin = await servedItems();
  await urlTransport(`${origin.url}/r`, fetch).read("button.json");
  expect(origin.received[0]?.headers.authorization).toBeUndefined();
});
