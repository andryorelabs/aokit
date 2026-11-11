import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLockfileSource } from "../../src/create/from.ts";

const root = mkdtempSync(join(tmpdir(), "aokit-from-errors-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function fetchReturning(response: Response): typeof fetch {
  return Object.assign(() => Promise.resolve(response), { preconnect: fetch.preconnect });
}

test("a --from path that does not exist is an invalid input naming the path", async () => {
  const missing = join(root, "absent", "aokit.lock.json");
  const failure = await readLockfileSource(missing).catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: "INVALID_INPUT" });
  expect(failure).toHaveProperty("message", `\`--from ${missing}\` does not exist`);
});

test("a --from path that cannot be inspected keeps its own error", async () => {
  const file = join(root, "plain.txt");
  writeFileSync(file, "x");
  const failure = await readLockfileSource(join(file, "aokit.lock.json")).catch(
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({ code: "ENOTDIR" });
});

test("a response body that fails while reading is a fetch failure", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.error(new Error("connection reset"));
    },
  });
  const failure = await readLockfileSource("https://example.test/aokit.lock.json", {
    fetch: fetchReturning(new Response(body)),
  }).catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: "REGISTRY_FETCH_FAILED" });
  expect(String(failure)).toContain("connection reset");
});
