import { expect, test } from "bun:test";
import { mergeYaml } from "../../src/patchers/yaml/index.ts";

const source = `# top comment
base: &base
  image: node # inline comment
services:
  web:
    <<: *base
    ports: ["80"]
`;

test("mergeYaml keeps comments and anchors", () => {
  const result = mergeYaml(source, {
    services: { web: { ports: ["80", "443"] }, db: { image: "pg" } },
  });
  expect(result).toContain("# top comment");
  expect(result).toContain("# inline comment");
  expect(result).toContain("&base");
  expect(result).toContain("*base");
  expect(result).toContain("443");
  expect(result).toContain("db:");
});

test("mergeYaml is idempotent", () => {
  const patch = { services: { web: { ports: ["443"] } }, extra: 1 };
  const once = mergeYaml(source, patch);
  expect(mergeYaml(once, patch)).toBe(once);
});

test("mergeYaml creates a document from empty text", () => {
  expect(mergeYaml("", { a: 1 })).toBe("a: 1\n");
});

test("mergeYaml keeps anchors and the data behind an aliased value", () => {
  const result = mergeYaml("base: &b\n  a: 1\ndev: *b\n", { dev: { c: 2 } });
  expect(result).toContain("base: &b");
  expect(result).toContain("a: 1");
  expect(result).toContain("c: 2");
  expect(mergeYaml(result, { dev: { c: 2 } })).toBe(result);
});

test("mergeYaml does not duplicate a value already present through an alias", () => {
  const aliased = "x: &x foo\nlist: [*x]\n";
  expect(mergeYaml(aliased, { list: ["foo"] })).toBe(mergeYaml(aliased, {}));
});
