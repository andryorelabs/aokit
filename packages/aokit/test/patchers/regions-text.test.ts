import { describe, expect, test } from "bun:test";
import { appendRegion } from "../../src/patchers/markdown/index.ts";
import {
  markerSyntaxFor,
  parseRegions,
  regionDigest,
  RegionSyntaxError,
  removeRegion,
  spliceRegions,
  upsertRegion,
} from "../../src/patchers/markdown/regions.ts";

const cases: readonly (readonly [string, string])[] = [
  ["README.md", "<!-- aokit:begin m:r -->"],
  ["docs/page.mdx", "<!-- aokit:begin m:r -->"],
  ["prisma/schema.prisma", "// aokit:begin m:r"],
  ["src/a.ts", "// aokit:begin m:r"],
  ["src/a.tsx", "// aokit:begin m:r"],
  ["src/a.js", "// aokit:begin m:r"],
  [".gitignore", "# aokit:begin m:r"],
  [".dockerignore", "# aokit:begin m:r"],
  [".env.example", "# aokit:begin m:r"],
  ["ci/workflow.yml", "# aokit:begin m:r"],
  ["pyproject.toml", "# aokit:begin m:r"],
  ["Dockerfile", "# aokit:begin m:r"],
];

describe("markerSyntaxFor", () => {
  test.each(cases)("%s uses %s", (path, begin) => {
    const syntax = markerSyntaxFor(path);
    expect(syntax.begin("m:r")).toBe(begin);
    expect(syntax.end("m:r")).toBe(begin.replace("begin", "end"));
  });
});

describe("regions in any text file", () => {
  test.each(cases)("%s round-trips append, replace and remove", (path) => {
    const original = path.endsWith(".md") ? "intro\n" : "first line\n";
    const added = appendRegion(original, { module: "m:r", content: "one", path });
    const syntax = markerSyntaxFor(path);
    expect(added).toBe(`${original}\n${syntax.begin("m:r")}\none\n${syntax.end("m:r")}\n`);
    expect(parseRegions(added, path).map((span) => [span.id, span.body])).toEqual([["m:r", "one"]]);
    const replaced = appendRegion(added, { module: "m:r", content: "two", path });
    expect(parseRegions(replaced, path)[0]?.body).toBe("two");
    expect(removeRegion(replaced, "m:r", path)).toBe(original);
    expect(
      appendRegion(removeRegion(replaced, "m:r", path), { module: "m:r", content: "two", path }),
    ).toBe(replaced);
  });

  test("an unknown path keeps the Markdown behavior", () => {
    expect(appendRegion("x\n", { module: "a", content: "b" })).toBe(
      "x\n\n<!-- aokit:begin a -->\nb\n<!-- aokit:end a -->\n",
    );
  });

  test("a start marker without an end is rejected", () => {
    expect(() => parseRegions("# aokit:begin a\nx\n", ".gitignore")).toThrow(RegionSyntaxError);
  });

  test("top placement, splice and digest work with comment markers", () => {
    const path = "src/a.ts";
    const rendered = upsertRegion("", { id: "aokit:header", content: "h" }, "top", path);
    const spliced = spliceRegions("const x = 1;\n", rendered, path);
    expect(spliced.startsWith("// aokit:begin aokit:header\nh\n// aokit:end aokit:header")).toBe(
      true,
    );
    expect(regionDigest(spliced, path)).toBe(
      "// aokit:begin aokit:header\nh\n// aokit:end aokit:header",
    );
  });

  test("a Markdown marker in a .ts file is ordinary text", () => {
    expect(parseRegions("<!-- aokit:begin a -->\n", "src/a.ts")).toEqual([]);
  });
});

describe("marker-looking strings are not Regions", () => {
  test("a string literal in a .ts file", () => {
    const source = [
      'const a = "// aokit:begin fake";',
      "const b = '// aokit:begin fake2';",
      "const c = `",
      "// aokit:begin fake3",
      "// aokit:end fake3",
      "`;",
      "",
    ].join("\n");
    expect(parseRegions(source, "src/a.ts")).toEqual([]);
    const added = appendRegion(source, { module: "m:r", content: "real", path: "src/a.ts" });
    expect(parseRegions(added, "src/a.ts").map((span) => span.id)).toEqual(["m:r"]);
    expect(removeRegion(added, "m:r", "src/a.ts")).toBe(source);
  });

  test("a marker after code on the same line is not a Region", () => {
    expect(parseRegions("run(); // aokit:begin a\n", "src/a.ts")).toEqual([]);
    expect(parseRegions("key: v # aokit:begin a\n", "a.yml")).toEqual([]);
  });

  test("a quote inside a comment does not start a string", () => {
    const source = "// don't\n// aokit:begin a\nx\n// aokit:end a\n";
    expect(parseRegions(source, "src/a.ts").map((span) => span.id)).toEqual(["a"]);
  });
});
