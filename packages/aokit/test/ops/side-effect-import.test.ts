import { expect, test } from "bun:test";
import { opSchema, parseManifest } from "@aokit/module";
import { type EngineContext, type EngineModule, buildPlan } from "../../src/engine/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };
const layouts = ["single", "monorepo"] as const;
const stylesSource = `import "./reset.css";\n\nexport const styles = [];\n`;

function moduleOf(manifest: Record<string, unknown>, sources: Record<string, string> = {}) {
  return {
    manifest: parseManifest({ version: "1.0.0", ...manifest }),
    readFile: (from: string) => sources[from] ?? "",
  } satisfies EngineModule;
}

const base = moduleOf(
  {
    name: "base",
    files: [{ from: "styles.ts", to: "styles.ts", target: "web" }],
    extensionPoints: [
      {
        name: "web.styles",
        version: "1.0.0",
        target: "web",
        kind: "import-list",
        anchor: "styles",
      },
    ],
  },
  { "styles.ts": stylesSource },
);

function styleModule(name: string, specifiers: readonly string[]) {
  return moduleOf({
    name,
    ops: specifiers.map((from) => ({
      op: "addImport",
      target: "web",
      extensionPoint: "web.styles",
      range: "^1",
      from,
      sideEffect: true,
    })),
  });
}

async function render(layout: (typeof layouts)[number], modules: EngineModule[]): Promise<string> {
  const plan = await buildPlan({ modules: [base, ...modules], layout, answers: {}, context });
  const path = layout === "single" ? "styles.ts" : "apps/web/styles.ts";
  const content = plan.vfs.read(path);
  if (typeof content !== "string") {
    throw new Error("styles.ts missing");
  }
  return content;
}

test.each(layouts)("addImport sideEffect writes a bare import (%s)", async (layout) => {
  const result = await render(layout, [styleModule("tw", ["tailwindcss/index.css"])]);
  expect(result).toContain('import "./reset.css";\nimport "tailwindcss/index.css";');
});

test("addImport sideEffect skips an import that already exists", async () => {
  const result = await render("single", [styleModule("tw", ["./reset.css"])]);
  expect(result.match(/reset\.css/g)).toHaveLength(1);
});

test("addImport sideEffect deduplicates across Modules", async () => {
  const result = await render("single", [
    styleModule("one", ["./x.css"]),
    styleModule("two", ["./x.css"]),
  ]);
  expect(result.match(/x\.css/g)).toHaveLength(1);
});

test("addImport accepts sideEffect alone and rejects an empty import", () => {
  const op = {
    op: "addImport",
    target: "web",
    extensionPoint: "web.styles",
    range: "^1",
    from: "x",
  };
  expect(opSchema.safeParse({ ...op, sideEffect: true }).success).toBe(true);
  expect(opSchema.safeParse({ ...op, sideEffect: false }).success).toBe(false);
});
