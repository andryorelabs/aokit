import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const fixtureFiles: Record<string, string> = {
  "catalog/2026.11.0.json": `${JSON.stringify(
    {
      release: "2026.11.0",
      dependencies: { oxfmt: "0.75.0", oxlint: "1.90.0" },
      pinGroups: { oxc: ["oxlint", "oxfmt"] },
    },
    null,
    2,
  )}\n`,
  "oxc/module.ts": `export default {
  name: "oxc",
  version: "1.0.0",
  description: "Fixture Oxc linting.",
  provides: ["lint", "format"],
  files: [
    { from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" },
    { from: "files/nested/notes.md", to: "notes.md", target: "root" },
  ],
  deps: { devDependencies: { oxlint: { range: "catalog", pinGroup: "oxc" } } },
};
`,
  "oxc/files/.oxlintrc.json": `{\r\n  "ignorePatterns": []\r\n}\r\n`,
  "oxc/files/nested/notes.md": "# {{name}}\n",
  "knip/module.ts": `export default {
  name: "knip",
  version: "2.1.0",
  description: "Fixture unused code finder.",
  provides: ["unused-code"],
  requires: ["lint"],
};
`,
};

const migrationModuleSource = `export default {
  name: "oxc",
  version: "2.0.0",
  description: "Fixture Oxc linting.",
  provides: ["lint", "format"],
  files: [{ from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" }],
  migrations: [
    { from: ">=1 <2", to: "2.0.0", stage: "before", script: "migrations/1-to-2.before.js" },
  ],
};
`;

const migrationScriptSource = `import { defineMigration } from "@aokit/module";

export default defineMigration(({ answers }) => {
  const { appRouter, ...rest } = answers;
  return { ...rest, router: appRouter };
});
`;

/**
 * Turns the \`oxc\` Module of a fixture source tree into version 2.0.0 shipping a \`before\`
 * Migration (\`migrations/1-to-2.before.ts\`) and a Renames manifest (\`renames.json\`).
 */
export async function addMigrationToFixtureSource(root: string): Promise<void> {
  await mkdir(join(root, "oxc/migrations"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "oxc/module.ts"), migrationModuleSource, "utf8"),
    writeFile(join(root, "oxc/migrations/1-to-2.before.ts"), migrationScriptSource, "utf8"),
    writeFile(join(root, "oxc/renames.json"), `{ "src/routes.tsx": "src/router.tsx" }\n`, "utf8"),
  ]);
}

/**
 * Writes a small Registry source tree (Catalog plus the `oxc` and `knip` Modules) to a fresh
 * temporary directory and returns its path.
 */
export async function writeRegistrySourceFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aokit-registry-src-"));
  await Promise.all(
    Object.entries(fixtureFiles).map(async ([path, content]) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content, "utf8");
    }),
  );
  return root;
}
