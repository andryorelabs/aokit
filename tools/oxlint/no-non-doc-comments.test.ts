import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..", "..");
const oxlintBin = join(repositoryRoot, "node_modules", ".bin", "oxlint");
const localPluginPath = join(import.meta.dir, "local-plugin.ts");
const ruleName = "local/no-non-doc-comments";

let scratchDirectory = "";
let fixtureCounter = 0;

beforeAll(async () => {
  scratchDirectory = await mkdtemp(join(tmpdir(), "aokit-no-non-doc-comments-"));
  await Bun.write(
    join(scratchDirectory, ".oxlintrc.json"),
    JSON.stringify({
      categories: { correctness: "off" },
      jsPlugins: [localPluginPath],
      rules: { [ruleName]: "error" },
    }),
  );
});

afterAll(async () => {
  await rm(scratchDirectory, { recursive: true, force: true });
});

/**
 * Lints one source text with only `local/no-non-doc-comments` enabled and
 * returns the messages the rule reported.
 */
async function lintWithLocalRule(sourceText: string): Promise<string[]> {
  fixtureCounter += 1;
  const fixturePath = join(scratchDirectory, `fixture-${fixtureCounter}.ts`);
  await Bun.write(fixturePath, sourceText);
  const lintProcess = Bun.spawn(
    [
      oxlintBin,
      "--config",
      join(scratchDirectory, ".oxlintrc.json"),
      "--format",
      "json",
      fixturePath,
    ],
    { cwd: scratchDirectory, stdout: "pipe", stderr: "pipe" },
  );
  const [standardOutput, standardError] = await Promise.all([
    new Response(lintProcess.stdout).text(),
    new Response(lintProcess.stderr).text(),
  ]);
  await lintProcess.exited;
  return parseOxlintDiagnostics(standardOutput, standardError)
    .filter((diagnostic) => diagnostic.code.includes("no-non-doc-comments"))
    .map((diagnostic) => diagnostic.message);
}

interface OxlintDiagnostic {
  code: string;
  message: string;
}

/**
 * Narrows one entry of Oxlint's JSON `diagnostics` array.
 */
function isOxlintDiagnostic(candidate: unknown): candidate is OxlintDiagnostic {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "code" in candidate &&
    typeof candidate.code === "string" &&
    "message" in candidate &&
    typeof candidate.message === "string"
  );
}

/**
 * Parses Oxlint's `--format json` output, surfacing stdout and stderr when it
 * is not a report so plugin load failures are visible in the test failure.
 */
function parseOxlintDiagnostics(standardOutput: string, standardError: string): OxlintDiagnostic[] {
  const notAReport = new Error(
    `oxlint did not print a JSON report.\nstdout: ${standardOutput}\nstderr: ${standardError}`,
  );
  let report: unknown;
  try {
    report = JSON.parse(standardOutput);
  } catch (parseError) {
    throw new Error(notAReport.message, { cause: parseError });
  }
  if (
    typeof report !== "object" ||
    report === null ||
    !("diagnostics" in report) ||
    !Array.isArray(report.diagnostics)
  ) {
    throw notAReport;
  }
  const diagnostics: unknown[] = report.diagnostics;
  if (!diagnostics.every(isOxlintDiagnostic)) {
    throw notAReport;
  }
  return diagnostics;
}

describe(ruleName, () => {
  test("rejects an inline line comment", async () => {
    const messages = await lintWithLocalRule(
      "const answer = 42; // explains the answer\nexport { answer };\n",
    );
    expect(messages).toHaveLength(1);
  });

  test("rejects a standalone line comment", async () => {
    const messages = await lintWithLocalRule("// explains the answer\nexport const answer = 42;\n");
    expect(messages).toHaveLength(1);
  });

  test("rejects a non-doc block comment", async () => {
    const messages = await lintWithLocalRule(
      "/* explains the answer */\nexport const answer = 42;\n",
    );
    expect(messages).toHaveLength(1);
  });

  test("allows a TSDoc block on a declaration", async () => {
    const messages = await lintWithLocalRule(
      "/**\n * The answer.\n *\n * @returns The answer.\n */\nexport function answer(): number {\n  return 42;\n}\n",
    );
    expect(messages).toEqual([]);
  });

  test.each([
    "// oxlint-disable-next-line no-console",
    "// eslint-disable-next-line no-console",
    "/* eslint-disable */",
    "/* oxlint-disable */",
    "// @ts-expect-error intentionally wrong",
    "// @ts-ignore",
    "/* istanbul ignore next */",
    "/* c8 ignore next */",
    '/// <reference types="bun" />',
  ])("allows the tool directive %s", async (directive) => {
    const messages = await lintWithLocalRule(`${directive}\nexport const answer: number = 42;\n`);
    expect(messages).toEqual([]);
  });

  test("reports every offending comment in a file", async () => {
    const messages = await lintWithLocalRule(
      "// first\nconst answer = 42; /* second */\nexport { answer };\n",
    );
    expect(messages).toHaveLength(2);
  });
});
