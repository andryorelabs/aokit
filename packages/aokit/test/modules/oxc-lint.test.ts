import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildSelection } from "./support/index.ts";

const repositoryRoot = join(import.meta.dir, "..", "..", "..", "..");
const oxlintBinaryPath = join(repositoryRoot, "node_modules", "oxlint", "bin", "oxlint");

interface ReportedDiagnostic {
  code: string;
  filename: string;
}

let projectDirectory: string;

/**
 * Writes the oxc Module's single-layout render, plus a tsconfig, to a scratch Project whose
 * `node_modules` links to the repository's, where `oxlint-tsgolint` is installed.
 */
async function writeGeneratedProject(): Promise<string> {
  const built = await buildSelection(["oxc"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const directory = await mkdtemp(join(tmpdir(), "aokit-oxc-lint-"));
  await Promise.all(
    built.plan.vfs.paths().map(async (path) => {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, built.plan.vfs.read(path) ?? "");
    }),
  );
  await symlink(join(repositoryRoot, "node_modules"), join(directory, "node_modules"), "dir");
  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true, module: "preserve", noEmit: true, types: ["bun"] },
    }),
  );
  return directory;
}

/**
 * Runs Oxlint on the scratch Project with the flags of its `lint` script and returns the
 * reported rule codes per file.
 */
async function lintProject(): Promise<{ exitCode: number; diagnostics: ReportedDiagnostic[] }> {
  const lintProcess = Bun.spawn(
    [
      process.execPath,
      oxlintBinaryPath,
      "--type-aware",
      "--ignore-pattern",
      "**/node_modules/**",
      "-c",
      "./.oxlintrc.json",
      "--format",
      "json",
    ],
    { cwd: projectDirectory, stdout: "pipe", stderr: "pipe" },
  );
  const [standardOutput, standardError, exitCode] = await Promise.all([
    new Response(lintProcess.stdout).text(),
    new Response(lintProcess.stderr).text(),
    lintProcess.exited,
  ]);
  let report: unknown;
  try {
    report = JSON.parse(standardOutput);
  } catch (parseError) {
    throw new Error(
      `oxlint printed no JSON.\nstdout: ${standardOutput}\nstderr: ${standardError}`,
      {
        cause: parseError,
      },
    );
  }
  if (
    typeof report !== "object" ||
    report === null ||
    !("diagnostics" in report) ||
    !Array.isArray(report.diagnostics)
  ) {
    throw new Error(`oxlint report has no diagnostics.\nstdout: ${standardOutput}`);
  }
  const diagnostics: ReportedDiagnostic[] = report.diagnostics.map((diagnostic: unknown) => {
    const record = typeof diagnostic === "object" && diagnostic !== null ? diagnostic : {};
    const code = "code" in record && typeof record.code === "string" ? record.code : "";
    const filename =
      "filename" in record && typeof record.filename === "string" ? record.filename : "";
    return { code, filename };
  });
  return { exitCode, diagnostics };
}

beforeAll(async () => {
  projectDirectory = await writeGeneratedProject();
});

afterAll(async () => {
  await rm(projectDirectory, { recursive: true, force: true });
});

describe("oxc lint baseline in a generated Project", () => {
  test("the generated Project, its plugin included, lints clean", async () => {
    await writeFile(
      join(projectDirectory, "sum.test.ts"),
      'import { expect, test } from "bun:test";\n\ntest("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n',
    );
    const { exitCode, diagnostics } = await lintProject();
    expect(diagnostics).toEqual([]);
    expect(exitCode).toBe(0);
  }, 60_000);

  test("test.only imported from bun:test fails the lint", async () => {
    await writeFile(
      join(projectDirectory, "sum.test.ts"),
      'import { expect, test } from "bun:test";\n\ntest.only("adds", () => {\n  expect(1 + 1).toBe(2);\n});\n',
    );
    const { exitCode, diagnostics } = await lintProject();
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("local(no-bun-test-only)");
    expect(exitCode).not.toBe(0);
  }, 60_000);
});
