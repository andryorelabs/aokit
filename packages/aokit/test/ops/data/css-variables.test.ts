import { expect, test } from "bun:test";
import { type ModuleManifestInput, parseManifest } from "@aokit/module";
import {
  type EngineContext,
  type EngineModule,
  Vfs,
  buildPlan,
} from "../../../src/engine/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function moduleOf(manifest: Partial<ModuleManifestInput> & { name: string }): EngineModule {
  return {
    manifest: parseManifest({ version: "1.0.0", ...manifest }),
    readFile() {
      throw new Error("no files");
    },
  };
}

function seeded(files: Record<string, string>): Vfs {
  const vfs = Vfs.empty();
  for (const [path, content] of Object.entries(files)) vfs.write(path, content);
  return vfs;
}

function themeOps(value: string): ModuleManifestInput["ops"] {
  return [
    {
      op: "addCssVariables",
      target: "web",
      file: "app.css",
      group: "theme",
      variables: { "--color-brand": value, "--radius": "0.5rem" },
    },
    {
      op: "addCssVariables",
      target: "web",
      file: "app.css",
      group: "light",
      variables: { "--background": "white" },
    },
    {
      op: "addCssVariables",
      target: "web",
      file: "app.css",
      group: "dark",
      variables: { "--background": "black" },
    },
  ];
}

async function run(
  manifest: Partial<ModuleManifestInput>,
  files: Record<string, string>,
): Promise<Vfs> {
  const plan = await buildPlan({
    modules: [moduleOf({ name: "demo", ...manifest })],
    layout: "single",
    answers: {},
    context,
    base: seeded(files),
  });
  return plan.vfs;
}

function snapshot(vfs: Vfs): Record<string, string> {
  return Object.fromEntries(vfs.paths().map((path) => [path, String(vfs.read(path))]));
}

test("addCssVariables writes the three groups and a second run is a no-op", async () => {
  const once = await run({ ops: themeOps("#fff") }, { "app.css": '@import "tailwindcss";\n' });
  const text = String(once.read("app.css"));
  expect(text).toContain("@theme {");
  expect(text).toContain("--color-brand: #fff");
  expect(text).toContain(":root {");
  expect(text).toContain(".dark {");
  expect(text).toContain("--background: black");
  const twice = await run({ ops: themeOps("#fff") }, snapshot(once));
  expect(snapshot(twice)).toEqual(snapshot(once));
});

test("addCssVariables keeps an existing value unless the Module declares an override", async () => {
  const files = { "app.css": "@theme {\n  --color-brand: red;\n}\n" };
  const kept = String((await run({ ops: themeOps("#fff") }, files)).read("app.css"));
  expect(kept).toContain("--color-brand: red");
  expect(kept).toContain("--radius: 0.5rem");

  const replaced = await run(
    { ops: themeOps("#fff"), override: [{ op: "addCssVariables", reason: "brand" }] },
    files,
  );
  expect(String(replaced.read("app.css"))).toContain("--color-brand: #fff");
});
