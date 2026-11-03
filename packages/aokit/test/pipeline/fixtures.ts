import { catalogSchema, parseManifest } from "@aokit/module";
import type { EngineContext, EngineModule } from "../../src/engine/index.ts";
import type { PipelineInput, RegistryInfo } from "../../src/pipeline/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };
const registry: RegistryInfo = {
  name: "fixture",
  source: "https://registry.example/fixture",
  release: "2026.11.0",
  minCliVersion: "0.0.0",
};
const catalog = catalogSchema.parse({
  dependencies: { next: "^16.0.0", oxlint: "^1.90.0", zod: "^4.0.0" },
  pinGroups: { oxc: ["oxlint"] },
});

const providersSource = `export const providers = [];\n\nexport const handlers = {};\n`;

function moduleOf(
  manifest: Record<string, unknown>,
  sources: Record<string, string> = {},
): EngineModule {
  return {
    manifest: parseManifest({ version: "1.0.0", ...manifest }),
    readFile: (from) => sources[from] ?? "",
  };
}

const point = (extensionPoint: string) => ({ target: "web", extensionPoint, range: "^1" });

/** Fixture Modules exercising files, deps, env and every Op. */
export function fixtureModules(): EngineModule[] {
  return [
    moduleOf(
      {
        name: "base",
        provides: ["web-base"],
        answers: { appName: { type: "string", default: "demo" } },
        files: [
          { from: "app.ts", to: "app.ts", target: "web" },
          { from: "readme.md", to: "__appName__.md", target: "root", ownership: "seed" },
          { from: "run.sh", to: "run.sh", target: "root", mode: "755" },
          { from: "providers.ts", to: "providers.ts", target: "web" },
        ],
        deps: {
          dependencies: { next: { range: "catalog" } },
          devDependencies: { oxlint: { range: "catalog", pinGroup: "oxc" } },
        },
        env: [{ key: "APP_URL", scope: "web", example: "http://localhost" }],
        extensionPoints: [
          {
            name: "web.providers",
            version: "1.0.0",
            target: "web",
            kind: "array",
            anchor: "providers",
          },
          {
            name: "web.handlers",
            version: "1.0.0",
            target: "web",
            kind: "object",
            anchor: "handlers",
          },
        ],
      },
      {
        "app.ts": "export const name = '{{appName}}';\n",
        "readme.md": "# {{appName}}\r\n",
        "run.sh": "#!/bin/sh\n",
        "providers.ts": providersSource,
      },
    ),
    moduleOf({
      name: "auth",
      requires: ["web-base"],
      deps: { dependencies: { zod: { range: "catalog" } } },
      ops: [
        { op: "addImport", ...point("web.providers"), from: "auth", named: ["Auth"] },
        { op: "addToArray", ...point("web.providers"), element: "Auth()" },
        { op: "registerAt", ...point("web.handlers"), key: "login", expression: "login" },
        { op: "mergeJson", target: "root", file: "tsconfig.json", value: { strict: true } },
        { op: "mergeYaml", target: "root", file: "ci.yml", value: { name: "ci" } },
        { op: "addEnv", target: "web", entries: { AUTH_SECRET: "change-me" } },
        {
          op: "addCssAtRule",
          target: "web",
          file: "app.css",
          rule: "import",
          params: '"tailwindcss"',
        },
        {
          op: "appendRegion",
          target: "root",
          file: "notes.md",
          region: "auth",
          content: "auth on",
        },
      ],
    }),
  ];
}

/** A pipeline input for the fixture Modules; override any field. */
export function input(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    selection: ["auth"],
    available: fixtureModules(),
    answers: {},
    layout: "single",
    catalog,
    context,
    registry,
    acceptSuggestions: true,
    ...overrides,
  };
}
