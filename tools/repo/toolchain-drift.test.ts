import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const toolingStandardPath = join(repoRoot, "docs", "standards", "tooling.md");
const toolchainHeading = "### Toolchain versions (E15)";

/** The files a toolchain drift check reads, already loaded. */
export interface ToolchainSources {
  /** The parsed root `package.json`. */
  readonly manifest: unknown;
  /** The raw content of `.node-version`. */
  readonly nodeVersion: string;
  /** Workflow file contents keyed by their repo-relative path. */
  readonly workflows: ReadonlyMap<string, string>;
}

/**
 * Parses the `### Toolchain versions (E15)` table of the tooling standard into tool name to
 * version, with backticks removed and a version cell reduced to its first token.
 */
export function parseToolchainTable(markdown: string): Map<string, string> {
  const start = markdown.indexOf(toolchainHeading);
  if (start === -1) {
    throw new Error(`tooling standard has no "${toolchainHeading}" section`);
  }
  const end = markdown.indexOf("\n#", start + toolchainHeading.length);
  const section = markdown.slice(start, end === -1 ? undefined : end);
  const table = new Map<string, string>();
  for (const line of section.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const [toolCell, versionCell] = cells;
    if (cells.length !== 2 || toolCell === undefined || versionCell === undefined) continue;
    if (toolCell === "Tool" || /^-+$/.test(toolCell)) continue;
    const tool = toolCell.replaceAll("`", "");
    const version = versionCell.replaceAll("`", "").split(/\s+/)[0] ?? "";
    table.set(tool, version);
  }
  return table;
}

/** Reads a field of a parsed JSON object, or undefined. */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const field: unknown = Reflect.get(value, key);
  return field;
}

/** Reads a string field of a parsed JSON object, or undefined. */
function stringField(value: unknown, key: string): string | undefined {
  const field = fieldOf(value, key);
  return typeof field === "string" ? field : undefined;
}

/** Reads a dependency's declared range from the manifest's `devDependencies` or `dependencies`. */
function declaredRange(manifest: unknown, packageName: string): string | undefined {
  for (const group of ["devDependencies", "dependencies"]) {
    const range = stringField(fieldOf(manifest, group), packageName);
    if (range !== undefined) return range;
  }
  return undefined;
}

/** Packages pinned exactly (E6, the Toolchain pin group); others may carry a caret range. */
const exactPins = new Set([
  "oxlint",
  "@oxlint/plugins",
  "oxfmt",
  "oxlint-tsgolint",
  "typescript7",
  "typescript",
]);

/** Checks a `package.json` dependency row. */
function checkPackageRow(tool: string, version: string, sources: ToolchainSources): string[] {
  const range = declaredRange(sources.manifest, tool);
  if (range === undefined) return [`package.json does not declare ${tool} (table: ${version})`];
  const declared = exactPins.has(tool) ? range : range.replace(/^\^/, "");
  return declared === version ? [] : [`package.json ${tool} is ${range}, table says ${version}`];
}

/** Collects every value of `pattern`'s first group across workflows, with the file it came from. */
function workflowValues(
  workflows: ReadonlyMap<string, string>,
  pattern: RegExp,
): { file: string; value: string }[] {
  const found: { file: string; value: string }[] = [];
  for (const [file, text] of workflows) {
    for (const match of text.matchAll(pattern)) {
      found.push({ file, value: match[1] ?? "" });
    }
  }
  return found;
}

/** Checks that every workflow occurrence of `pattern` carries `version`, and that one exists. */
function checkWorkflowRow(
  tool: string,
  version: string,
  pattern: RegExp,
  sources: ToolchainSources,
): string[] {
  const found = workflowValues(sources.workflows, pattern);
  if (found.length === 0) return [`no workflow pins ${tool} (table: ${version})`];
  return found
    .filter(({ value }) => value !== version)
    .map(({ file, value }) => `${file} pins ${tool} ${value}, table says ${version}`);
}

/** Checks the `.node-version` row and that every `setup-node` step reads `.node-version`. */
function checkNodeRow(version: string, sources: ToolchainSources): string[] {
  const problems: string[] = [];
  const declared = sources.nodeVersion.trim();
  if (declared !== version) problems.push(`.node-version is ${declared}, table says ${version}`);
  for (const { file } of workflowValues(sources.workflows, /^\s*node-version:\s*(\S+)/gm)) {
    problems.push(`${file} sets node-version directly instead of reading .node-version`);
  }
  for (const { file, value } of workflowValues(
    sources.workflows,
    /^\s*node-version-file:\s*(\S+)/gm,
  )) {
    if (value !== ".node-version") problems.push(`${file} reads node-version-file ${value}`);
  }
  return problems;
}

/** Checks one table row against its source. */
function checkRow(tool: string, version: string, sources: ToolchainSources): string[] {
  switch (tool) {
    case "Bun (packageManager)": {
      const packageManager = stringField(sources.manifest, "packageManager");
      return packageManager === version
        ? []
        : [`package.json packageManager is ${String(packageManager)}, table says ${version}`];
    }
    case ".node-version":
      return checkNodeRow(version, sources);
    case "actionlint":
      return checkWorkflowRow(tool, version, /^\s*ACTIONLINT_VERSION:\s*(\S+)/gm, sources);
    case "zizmor":
      return checkWorkflowRow(tool, version, /^\s*ZIZMOR_VERSION:\s*(\S+)/gm, sources);
    case "lycheeverse/lychee-action":
      return checkWorkflowRow(tool, version, /lycheeverse\/lychee-action@([0-9a-f]+)/g, sources);
    default:
      return checkPackageRow(tool, version, sources);
  }
}

/** Returns one message per place where the repo's toolchain differs from the standard's table. */
export function findToolchainDrift(
  table: ReadonlyMap<string, string>,
  sources: ToolchainSources,
): string[] {
  if (table.size === 0) return ["the toolchain table is empty"];
  return [...table].flatMap(([tool, version]) => checkRow(tool, version, sources));
}

/** Lists the `.yml`/`.yaml` files under a directory, recursively, as absolute paths. */
function yamlFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => join(directory, name));
}

/** Loads the repo's real toolchain sources: root manifest, `.node-version` and every workflow. */
function readRepoSources(): ToolchainSources {
  const workflowFiles = [
    ...yamlFiles(join(repoRoot, ".github", "workflows")),
    ...yamlFiles(join(repoRoot, "registry-src", "github-ci", "files")),
  ];
  return {
    manifest: JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")),
    nodeVersion: readFileSync(join(repoRoot, ".node-version"), "utf8"),
    workflows: new Map(
      workflowFiles.map((file) => [relative(repoRoot, file), readFileSync(file, "utf8")]),
    ),
  };
}

const sampleTable = [
  "# Tooling",
  "",
  toolchainHeading,
  "",
  "| Tool | Version |",
  "| ---- | ------- |",
  "| `oxfmt` | 0.75.0 |",
  "| `@types/bun` | 1.4.4 |",
  "| Bun (`packageManager`) | `bun@1.4.4` |",
  "| `.node-version` | 26 |",
  "| actionlint | 1.7.12 |",
  "| `lycheeverse/lychee-action` | `e747` (v2.9.0) |",
  "",
  "## Next",
  "",
  "| `ignored` | 9 |",
].join("\n");

/** Sources that match `sampleTable`, with overrides. */
function sampleSources(overrides: Partial<ToolchainSources> = {}): ToolchainSources {
  return {
    manifest: {
      packageManager: "bun@1.4.4",
      devDependencies: { oxfmt: "0.75.0", "@types/bun": "^1.4.4" },
    },
    nodeVersion: "26\n",
    workflows: new Map([
      [
        "ci.yml",
        "      - uses: actions/setup-node@abc\n        with:\n          node-version-file: .node-version\n          ACTIONLINT_VERSION: 1.7.12\n      - uses: lycheeverse/lychee-action@e747 # v2.9.0\n",
      ],
    ]),
    ...overrides,
  };
}

describe("toolchain drift (E15)", () => {
  test("parses only the toolchain table, without backticks or version notes", () => {
    expect([...parseToolchainTable(sampleTable)]).toEqual([
      ["oxfmt", "0.75.0"],
      ["@types/bun", "1.4.4"],
      ["Bun (packageManager)", "bun@1.4.4"],
      [".node-version", "26"],
      ["actionlint", "1.7.12"],
      ["lycheeverse/lychee-action", "e747"],
    ]);
  });

  test("matching sources have no drift", () => {
    expect(findToolchainDrift(parseToolchainTable(sampleTable), sampleSources())).toEqual([]);
  });

  test("WHEN oxfmt in package.json differs from the table THEN the drift check fails", () => {
    const drift = findToolchainDrift(
      parseToolchainTable(sampleTable),
      sampleSources({
        manifest: {
          packageManager: "bun@1.4.4",
          devDependencies: { oxfmt: "0.74.0", "@types/bun": "^1.4.4" },
        },
      }),
    );
    expect(drift).toEqual(["package.json oxfmt is 0.74.0, table says 0.75.0"]);
  });

  test("an exact pin may not become a range", () => {
    const drift = findToolchainDrift(
      parseToolchainTable(sampleTable),
      sampleSources({
        manifest: {
          packageManager: "bun@1.4.4",
          devDependencies: { oxfmt: "^0.75.0", "@types/bun": "^1.4.4" },
        },
      }),
    );
    expect(drift).toEqual(["package.json oxfmt is ^0.75.0, table says 0.75.0"]);
  });

  test("flags .node-version, workflow pins and a hard-coded node-version", () => {
    const drift = findToolchainDrift(
      parseToolchainTable(sampleTable),
      sampleSources({
        nodeVersion: "24\n",
        workflows: new Map([
          [
            "ci.yml",
            "        with:\n          node-version: 24\n          ACTIONLINT_VERSION: 1.7.11\n      - uses: lycheeverse/lychee-action@f00 # v2.8.0\n",
          ],
        ]),
      }),
    );
    expect(drift).toEqual([
      ".node-version is 24, table says 26",
      "ci.yml sets node-version directly instead of reading .node-version",
      "ci.yml pins actionlint 1.7.11, table says 1.7.12",
      "ci.yml pins lycheeverse/lychee-action f00, table says e747",
    ]);
  });

  test("a table row with no source is drift", () => {
    const drift = findToolchainDrift(
      parseToolchainTable(sampleTable),
      sampleSources({ workflows: new Map(), manifest: {} }),
    );
    expect(drift).toContain("package.json does not declare oxfmt (table: 0.75.0)");
    expect(drift).toContain("no workflow pins actionlint (table: 1.7.12)");
  });

  test("the repo matches the tooling standard's toolchain table", () => {
    const table = parseToolchainTable(readFileSync(toolingStandardPath, "utf8"));
    expect(table.size).toBeGreaterThanOrEqual(12);
    expect(findToolchainDrift(table, readRepoSources())).toEqual([]);
  });
});

/** The first fenced JSON block of the `### sortImports (E13)` section of the tooling standard. */
function standardSortImports(): unknown {
  const text = readFileSync(toolingStandardPath, "utf8");
  const start = text.indexOf("### sortImports (E13)");
  expect(start).toBeGreaterThan(-1);
  const block = /```json\n([\s\S]*?)\n```/.exec(text.slice(start));
  if (block?.[1] === undefined) throw new Error("the sortImports section has no JSON block");
  return JSON.parse(block[1]);
}

/** Reads a JSON file under the repo root. */
function readRepoJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(repoRoot, ...segments), "utf8"));
}

/** Matches `name` against an oxfmt-style ignore glob, enough for the patterns the configs use. */
function isIgnoredBy(pattern: string, name: string): boolean {
  return new Bun.Glob(pattern).match(name);
}

describe("format config (E13, E14)", () => {
  const formatConfigs = [
    [".oxfmtrc.json", readRepoJson(".oxfmtrc.json")],
    ["oxc Module oxfmtrc.json", readRepoJson("registry-src", "oxc", "files", "oxfmtrc.json")],
  ] as const;

  test.each(formatConfigs)("%s carries the standard's sortImports", (_name, config) => {
    expect(config).toMatchObject({ sortImports: standardSortImports() });
  });

  test.each(formatConfigs)(
    "%s keeps .mts, .cts and .jsonc in the format scope",
    (_name, config) => {
      const ignorePatterns = fieldOf(config, "ignorePatterns");
      const patterns = Array.isArray(ignorePatterns) ? ignorePatterns.map(String) : [];
      for (const file of ["config.mts", "config.cts", "settings.jsonc", "src/a.mts"]) {
        expect(patterns.filter((pattern) => isIgnoredBy(pattern, file))).toEqual([]);
      }
    },
  );

  test("the root tsconfig includes root *.ts and *.mts config files", () => {
    const include = fieldOf(readRepoJson("tsconfig.json"), "include");
    const patterns = Array.isArray(include) ? include.map(String) : [];
    expect(["*.ts", "*.mts"].filter((pattern) => !patterns.includes(pattern))).toEqual([]);
  });
});
