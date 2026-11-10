import { expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AokitError } from "../../src/cli/envelope.ts";
import { gitLsRemote } from "../../src/registry/github.ts";

test("gitLsRemote raises REGISTRY_UNREACHABLE with a fix when git fails", async () => {
  const missing = join(tmpdir(), "aokit-missing-remote-repository");
  const failure = await gitLsRemote(missing, "main").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AokitError);
  if (!(failure instanceof AokitError)) throw new Error("expected an AokitError");
  expect(failure.code).toBe("REGISTRY_UNREACHABLE");
  expect(failure.fix).not.toBe("");
});
