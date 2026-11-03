import { expect, test } from "bun:test";
import { addEnv } from "../../src/patchers/env/index.ts";

test("addEnv adds missing keys and never overwrites existing ones", () => {
  const source = '# comment\nA=mine\nexport B="keep"\n';
  const result = addEnv(source, { A: "other", B: "x", C: "new" });
  expect(result).toBe('# comment\nA=mine\nexport B="keep"\nC=new\n');
});

test("addEnv is idempotent and handles empty text", () => {
  const once = addEnv("", { K: "v" });
  expect(once).toBe("K=v\n");
  expect(addEnv(once, { K: "v" })).toBe(once);
});

test("addEnv adds a newline before appending when missing", () => {
  expect(addEnv("A=1", { B: "2" })).toBe("A=1\nB=2\n");
});
