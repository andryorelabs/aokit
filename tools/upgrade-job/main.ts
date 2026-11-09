import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { curatedCombinations } from "../real-build/plan.ts";
import {
  type CaseResult,
  type Exec,
  buildCases,
  pairsOf,
  readIndex,
  releasedCombinations,
  runJob,
} from "./run.ts";

const workspaceRoot = join(import.meta.dir, "..", "..");

const exec: Exec = async (command, cwd) => {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: stdout === "" ? stderr : stdout };
};

function report(result: CaseResult): void {
  if (result.ok) {
    process.stdout.write(`PASS ${result.label}\n`);
    return;
  }
  const lines = result.failures.map((line) => `  ${line}`).join("\n");
  process.stdout.write(`FAIL ${result.label}\n${lines}\n`);
  if (process.env["GITHUB_ACTIONS"] === "true") {
    process.stdout.write(`::error::upgrade ${result.label} failed\n`);
  }
}

const registryDirectory = join(workspaceRoot, "registry");
const pairs = await pairsOf(registryDirectory);
const released = releasedCombinations(curatedCombinations, await readIndex(registryDirectory));
const scratch = await mkdtemp(join(tmpdir(), "aokit-upgrade-job-"));
const results = await runJob(
  buildCases(pairs, released),
  { exec, workspaceRoot, scratch, log: (line) => process.stdout.write(`${line}\n`) },
  report,
);
const failures = results.filter((result) => !result.ok);
process.stdout.write(
  `upgrade job: ${results.length - failures.length} passed, ${failures.length} failed\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
