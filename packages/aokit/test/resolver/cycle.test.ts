import { expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import { resolve } from "../../src/resolver/resolve.ts";

function mod(name: string, provides: string[], requires: string[]) {
  return parseManifest({
    name,
    version: "1.0.0",
    description: `Fixture Module ${name}.`,
    provides,
    requires,
  });
}

test("a cycle behind a Module outside it is reported from the cycle only", () => {
  const result = resolve({ modules: ["alpha", "beta", "gamma"] }, [
    mod("alpha", ["a"], ["b"]),
    mod("beta", ["b"], ["c"]),
    mod("gamma", ["c"], ["b"]),
  ]);
  if (result.ok) throw new Error("expected a failure");
  expect(result.error.code).toBe("dependency_cycle");
  expect(result.error.message).toBe(
    "modules form a dependency cycle: beta requires gamma requires beta.",
  );
});
