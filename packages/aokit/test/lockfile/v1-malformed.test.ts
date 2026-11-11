import { expect, test } from "bun:test";
import { LockfileError, parseLockfile } from "../../src/lockfile/index.ts";

const base = {
  lockfileVersion: 1,
  cliVersion: "0.0.0",
  protocolVersion: 1,
  layout: "single",
  registries: {},
  modules: {},
  files: {},
  deps: {},
};

function failureOf(raw: unknown): LockfileError {
  try {
    parseLockfile(JSON.stringify(raw));
  } catch (thrown) {
    if (thrown instanceof LockfileError) return thrown;
    throw thrown;
  }
  throw new Error("expected the Lockfile to be rejected");
}

test("a v1 Lockfile whose sections are not objects is rejected by the schema, not rewritten", () => {
  const error = failureOf({ ...base, files: [], deps: "none" });
  expect(error.code).toBe("LOCKFILE_INVALID");
  expect(error.message).toContain("files");
  expect(error.message).toContain("deps");
});

test("a v1 file entry whose owners are not a list is rejected by the schema", () => {
  const error = failureOf({
    ...base,
    files: { "a.txt": { owners: "mod", mode: "managed", hash: "sha256-x" } },
  });
  expect(error.code).toBe("LOCKFILE_INVALID");
  expect(error.message).toContain("files.a.txt.owners");
});
