import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { parseJsonRecord } from "../helpers/registry-json.ts";

/** One request a {@link ServedRegistry} received: its path and its headers, names lowercased. */
interface ReceivedRequest {
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * A Registry directory served over HTTP on an ephemeral loopback port, recording every requested
 * path in `requests` and every request with its headers in `received`. `failPaths` answer 500 and
 * `redirects` answer 302 to another URL.
 */
export interface ServedRegistry {
  readonly url: string;
  readonly requests: string[];
  readonly received: ReceivedRequest[];
  readonly failPaths: Set<string>;
  readonly redirects: Map<string, string>;
  stop(): Promise<void>;
}

const temporaryDirectories: string[] = [];

/** Removes every directory {@link builtFixtureRegistry} created. */
export async function removeTemporaryDirectories(): Promise<void> {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
}

/** Builds the fixture Registry source (`oxc`, `knip`) into a fresh directory. */
export async function builtFixtureRegistry(): Promise<string> {
  const source = await writeRegistrySourceFixture();
  const out = await mkdtemp(join(tmpdir(), "aokit-registry-client-"));
  temporaryDirectories.push(source, out);
  await buildRegistry(source, out);
  return out;
}

/** Rewrites a JSON file of a Registry directory in place. */
export async function editJson(
  path: string,
  edit: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = parseJsonRecord(await readFile(path, "utf8"));
  edit(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Serves `root` with `Bun.serve` on an ephemeral port of 127.0.0.1. */
export function serveRegistry(root: string): ServedRegistry {
  const requests: string[] = [];
  const received: ReceivedRequest[] = [];
  const failPaths = new Set<string>();
  const redirects = new Map<string, string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, "");
      requests.push(path);
      received.push({ path, headers: Object.fromEntries(request.headers.entries()) });
      if (failPaths.has(path)) {
        return new Response("boom", { status: 500 });
      }
      const target = redirects.get(path);
      if (target !== undefined) {
        return Response.redirect(target, 302);
      }
      const file = Bun.file(join(root, path));
      return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    received,
    failPaths,
    redirects,
    stop: () => server.stop(true),
  };
}
