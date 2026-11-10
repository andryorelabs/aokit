import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..", "..");
const oxlintBinaryPath = join(repositoryRoot, "node_modules", "oxlint", "bin", "oxlint");
const localPluginPath = join(import.meta.dir, "local-plugin.ts");

/**
 * A scratch directory that lints source texts with exactly one local rule enabled.
 */
export interface LocalRuleLinter {
  lint(sourceText: string): Promise<string[]>;
  dispose(): Promise<void>;
}

interface ReportedDiagnostic {
  code: string;
  message: string;
}

function hasDiagnostics(report: unknown): report is { diagnostics: ReportedDiagnostic[] } {
  return (
    typeof report === "object" &&
    report !== null &&
    "diagnostics" in report &&
    Array.isArray(report.diagnostics)
  );
}

/**
 * Creates a linter for one `local/<ruleName>` rule. `lint` returns the
 * messages that rule reported for the source text.
 */
export async function createLocalRuleLinter(ruleName: string): Promise<LocalRuleLinter> {
  const scratchDirectory = await mkdtemp(join(tmpdir(), `aokit-${ruleName}-`));
  const configPath = join(scratchDirectory, ".oxlintrc.json");
  await Bun.write(
    configPath,
    JSON.stringify({
      categories: { correctness: "off" },
      jsPlugins: [localPluginPath],
      rules: { [`local/${ruleName}`]: "error" },
    }),
  );
  let fixtureCounter = 0;
  return {
    async lint(sourceText) {
      fixtureCounter += 1;
      const fixturePath = join(scratchDirectory, `fixture-${fixtureCounter}.ts`);
      await Bun.write(fixturePath, sourceText);
      const lintProcess = Bun.spawn(
        [
          process.execPath,
          oxlintBinaryPath,
          "--config",
          configPath,
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
      let report: unknown;
      try {
        report = JSON.parse(standardOutput);
      } catch (parseError) {
        throw new Error(
          `oxlint printed no JSON report.\nstdout: ${standardOutput}\nstderr: ${standardError}`,
          { cause: parseError },
        );
      }
      if (!hasDiagnostics(report)) {
        throw new Error(`oxlint report has no diagnostics.\nstdout: ${standardOutput}`);
      }
      return report.diagnostics
        .filter((diagnostic) => diagnostic.code.includes(ruleName))
        .map((diagnostic) => diagnostic.message);
    },
    async dispose() {
      await rm(scratchDirectory, { recursive: true, force: true });
    },
  };
}
