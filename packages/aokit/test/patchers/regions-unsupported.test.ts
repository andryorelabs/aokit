import { expect, test } from "bun:test";

import { appendRegion } from "../../src/patchers/markdown/index.ts";
import { parseRegions, RegionSyntaxError } from "../../src/patchers/markdown/regions.ts";

test.each(["package.json", "tsconfig.jsonc", "src/styles.css", "index.html", "data.xml"])(
  "appendRegion rejects %s instead of writing markers that corrupt it",
  (path) => {
    expect(() => appendRegion("x\n", { module: "m:r", content: "c", path })).toThrow(
      RegionSyntaxError,
    );
  },
);

test.each([
  ".gitignore",
  ".dockerignore",
  ".env.example",
  ".github/labels.yml",
  "compose.yaml",
  "renovate.toml",
  "Dockerfile",
])("appendRegion keeps hash markers for %s", (path) => {
  expect(appendRegion("x\n", { module: "m:r", content: "c", path })).toContain("# aokit:begin m:r");
});

test("a backtick inside a regex literal does not hide a later Region", () => {
  const text = "const re = /`/;\n// aokit:begin m:r\nx\n// aokit:end m:r\n";
  expect(parseRegions(text, "src/a.ts")).toHaveLength(1);
  const updated = appendRegion(text, { module: "m:r", content: "y", path: "src/a.ts" });
  expect(updated.match(/aokit:begin m:r/g)).toHaveLength(1);
  expect(updated).toContain("y");
});

test("a regex literal with a slash inside a class and a division do not break masking", () => {
  const text =
    "const a = /[/`]/g;\nconst b = 4 / 2;\n// aokit:begin m:r\nx\n// aokit:end m:r\nconst s = '// aokit:begin z';\n";
  expect(parseRegions(text, "src/a.ts").map((span) => span.id)).toEqual(["m:r"]);
});
