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
