import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { catalogSchema, parseManifest } from "@aokit/module";
import { z } from "zod";
import { Vfs } from "../../src/engine/index.ts";
import {
  FormatError,
  createOxfmtFormatter,
  formatterForSelection,
} from "../../src/format/index.ts";
import { buildProject } from "../../src/pipeline/index.ts";
import { input } from "../pipeline/fixtures.ts";

const packageRoot = join(import.meta.dir, "..", "..");

const versionSchema = z.object({ version: z.string() });
const dependenciesSchema = z.object({ dependencies: z.record(z.string(), z.string()) });

async function readJson(path: string): Promise<unknown> {
  const text: string = await readFile(path, "utf8");
  return JSON.parse(text);
}

async function installedOxfmtVersion(): Promise<string> {
  const manifest = await readJson(join(packageRoot, "node_modules", "oxfmt", "package.json")).catch(
    () => readJson(join(packageRoot, "..", "..", "node_modules", "oxfmt", "package.json")),
  );
  return versionSchema.parse(manifest).version;
}

async function formatErrorOf(action: () => unknown): Promise<FormatError> {
  try {
    await action();
  } catch (caught) {
    if (caught instanceof FormatError) return caught;
    throw caught;
  }
  throw new Error("expected a FormatError");
}

function catalogWith(oxfmtVersion: string) {
  return catalogSchema.parse({
    dependencies: { oxfmt: oxfmtVersion, oxlint: "1.90.0" },
    pinGroups: { oxc: ["oxlint", "oxfmt"] },
  });
}

const catalog = catalogWith(await installedOxfmtVersion());

const badlyIndentedMain = `import {createRoot} from "react-dom/client"
export function main(){
        const root=createRoot(document.body)
   root.render(<div>   hi</div>)
}
`;

const oxcModule = {
  manifest: parseManifest({
    name: "oxc",
    version: "1.0.0",
    provides: ["lint", "format"],
    files: [{ from: "main.tsx", to: "src/main.tsx", target: "root" }],
  }),
  readFile: () => badlyIndentedMain,
};

async function formatOne(vfs: Vfs): Promise<Vfs> {
  return createOxfmtFormatter({ catalog }).format(vfs);
}

describe("createOxfmtFormatter", () => {
  test("the Plan holds Oxfmt-formatted content with a stable hash", async () => {
    const formatter = formatterForSelection({ catalog, modules: [oxcModule.manifest] });
    if (formatter === undefined) throw new Error("expected a Formatter for oxc");
    const run = () =>
      buildProject(input({ selection: ["oxc"], available: [oxcModule], formatter }));
    const first = await run();
    const second = await run();
    if (!first.ok || !second.ok) throw new Error("pipeline failed");

    const main = first.plan.vfs.read("src/main.tsx");
    expect(main).toBe(`import { createRoot } from "react-dom/client";
export function main() {
  const root = createRoot(document.body);
  root.render(<div> hi</div>);
}
`);
    expect(first.plan.changes.find((c) => c.path === "src/main.tsx")?.provenance).toContainEqual({
      module: "oxfmt",
      entry: { kind: "formatter" },
    });
    expect(first.plan.hash).toBe(second.plan.hash);
  });

  test("the Agent files are byte-identical with and without oxc, for both Layouts", async () => {
    const formatter = formatterForSelection({ catalog, modules: [oxcModule.manifest] });
    if (formatter === undefined) throw new Error("expected a Formatter for oxc");
    for (const layout of ["single", "monorepo"] as const) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- two layouts, ordered
      const plain = await buildProject(input({ selection: [], available: [], layout }));
      // oxlint-disable-next-line eslint/no-await-in-loop -- two layouts, ordered
      const formatted = await buildProject(
        input({ selection: [], available: [], layout, formatter }),
      );
      if (!plain.ok || !formatted.ok) throw new Error("pipeline failed");
      for (const path of ["AGENTS.md", "CLAUDE.md"]) {
        expect(formatted.plan.vfs.read(path)).toBe(plain.plan.vfs.read(path));
      }
    }
  });

  test("honors the Project's .oxfmtrc.json from the VFS", async () => {
    const vfs = Vfs.empty();
    vfs.write(".oxfmtrc.json", '{\n  // jsonc\n  "semi": false,\n  "singleQuote": true\n}\n');
    vfs.write("src/a.ts", 'const a = "x";\n');
    const formatted = await formatOne(vfs);
    expect(formatted.read("src/a.ts")).toBe("const a = 'x'\n");
  });

  test("honors ignorePatterns and overrides from .oxfmtrc.json", async () => {
    const vfs = Vfs.empty();
    vfs.write(
      ".oxfmtrc.json",
      JSON.stringify({
        ignorePatterns: ["generated"],
        overrides: [{ files: ["*.js"], options: { semi: false } }],
      }),
    );
    vfs.write("generated/x.ts", "const   a=1\n");
    vfs.write("lib/b.js", "const   b=1\n");
    vfs.write("lib/c.ts", "const   c=1\n");
    const formatted = await formatOne(vfs);
    expect(formatted.read("generated/x.ts")).toBe("const   a=1\n");
    expect(formatted.read("lib/b.js")).toBe("const b = 1\n");
    expect(formatted.read("lib/c.ts")).toBe("const c = 1;\n");
  });

  test("an invalid .oxfmtrc.json fails naming the file", async () => {
    const vfs = Vfs.empty();
    vfs.write(".oxfmtrc.json", "{ semi: ");
    vfs.write("a.ts", "const a = 1;\n");
    const error = await formatErrorOf(() => formatOne(vfs));
    expect(error.code).toBe("format.invalid-config");
    expect(error.message).toContain(".oxfmtrc.json");
  });

  test("leaves files Oxfmt does not support untouched", async () => {
    const vfs = Vfs.empty();
    vfs.write("Dockerfile", "FROM   oven/bun\n");
    vfs.write(".env.example", "A=1\n");
    vfs.write("logo.png", new Uint8Array([137, 80, 78, 71]));
    const formatted = await formatOne(vfs);
    expect(formatted.read("Dockerfile")).toBe("FROM   oven/bun\n");
    expect(formatted.read(".env.example")).toBe("A=1\n");
    expect(formatted.read("logo.png")).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  test("a format error on a supported file fails naming the file", async () => {
    const vfs = Vfs.empty();
    vfs.write("src/broken.ts", "const = ;\n");
    const error = await formatErrorOf(() => formatOne(vfs));
    expect(error.code).toBe("format.failed");
    expect(error.message).toContain("src/broken.ts");
    expect(error.fix.length).toBeGreaterThan(0);
  });

  test("fails naming both versions when the Catalog oxc pin differs from the installed oxfmt", async () => {
    const installed = await installedOxfmtVersion();
    const error = await formatErrorOf(() =>
      createOxfmtFormatter({ catalog: catalogWith("0.1.0") }),
    );
    expect(error.code).toBe("format.version-mismatch");
    expect(error.message).toContain("0.1.0");
    expect(error.message).toContain(installed);
  });

  test("fails when the Catalog's oxc pin group does not list oxfmt", () => {
    const withoutOxfmt = catalogSchema.parse({
      dependencies: { oxlint: "1.90.0" },
      pinGroups: { oxc: ["oxlint"] },
    });
    expect(() => createOxfmtFormatter({ catalog: withoutOxfmt })).toThrow(FormatError);
  });
});

describe("formatterForSelection", () => {
  test("returns no Formatter when no selected Module provides format", () => {
    const other = parseManifest({ name: "web", version: "1.0.0", provides: ["web"] });
    expect(formatterForSelection({ catalog, modules: [other] })).toBeUndefined();
  });
});

test("oxfmt is an exact runtime dependency equal to the installed version", async () => {
  const manifest = dependenciesSchema.parse(await readJson(join(packageRoot, "package.json")));
  expect(manifest.dependencies["oxfmt"]).toBe(await installedOxfmtVersion());
});
