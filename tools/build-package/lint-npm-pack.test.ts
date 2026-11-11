import { afterEach, expect, spyOn, test } from "bun:test";
import { packedPathsOf } from "./lint.ts";

async function failureOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => "",
    (error: unknown) => String(error),
  );
}

function stubNpm(output: string, exitCode = 0) {
  const fakeSubprocess = () => ({
    stdout: new Response(output).body,
    stderr: new Response("").body,
    exited: Promise.resolve(exitCode),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the three fields lint.ts reads are stubbed
  return spyOn(Bun, "spawn").mockImplementation(fakeSubprocess as unknown as typeof Bun.spawn);
}

let spawnStub: ReturnType<typeof stubNpm> | undefined;

afterEach(() => {
  spawnStub?.mockRestore();
  spawnStub = undefined;
});

async function packedPathsFor(output: string): Promise<string[]> {
  spawnStub = stubNpm(output);
  return packedPathsOf("/stubbed/package");
}

test("a report with files lists their paths and skips entries without one", async () => {
  const output = JSON.stringify([{ files: [{ path: "dist/cli.js" }, { size: 1 }, "stray"] }]);
  expect(await packedPathsFor(output)).toEqual(["dist/cli.js"]);
});

test("an npm report that is not an object with files is rejected", async () => {
  expect(await failureOf(packedPathsFor("[]"))).toContain("npm pack reported no files");
  expect(await failureOf(packedPathsFor('[{"name":"x"}]'))).toContain("npm pack reported no files");
});

test("an npm report whose files is not a list is rejected", async () => {
  expect(await failureOf(packedPathsFor('[{"files":{}}]'))).toContain("no file list");
});

test("a failing npm command reports its command line and output", async () => {
  spawnStub = stubNpm("boom", 1);
  expect(await failureOf(packedPathsOf("/stubbed/package"))).toContain(
    "npm pack --dry-run --json failed in /stubbed/package",
  );
});
