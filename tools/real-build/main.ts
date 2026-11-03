import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Combination, type LayoutName, curatedCombinations } from "./plan.ts";
import { type CombinationResult, type Exec, runCombination } from "./run.ts";

const workspaceRoot = join(import.meta.dir, "..", "..");
const usage =
  "usage: bun tools/real-build/main.ts [--layout single|monorepo] [--modules a,b,c] [--registry <path>]";

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
  return { exitCode, output: stderr === "" ? stdout : `${stdout}${stderr}` };
};

function isLayout(value: string): value is LayoutName {
  return value === "single" || value === "monorepo";
}

function selectCombinations(
  layout: string | undefined,
  modules: string | undefined,
): Combination[] {
  if (layout !== undefined && !isLayout(layout)) {
    throw new Error(`unknown layout "${layout}"; ${usage}`);
  }
  if (modules !== undefined) {
    const selection = modules.split(",").filter((name) => name !== "");
    const layouts: LayoutName[] = layout === undefined ? ["single", "monorepo"] : [layout];
    return layouts.map((entry) => ({ layout: entry, modules: selection }));
  }
  return curatedCombinations.filter(
    (combination) => layout === undefined || combination.layout === layout,
  );
}

function slug(combination: Combination): string {
  return `${combination.layout}-${combination.modules.join("-")}`;
}

function report(result: CombinationResult): void {
  if (result.ok) {
    process.stdout.write(`PASS ${result.label}\n`);
    return;
  }
  const output = (result.output ?? "").trim().split("\n").slice(-40).join("\n");
  process.stdout.write(`FAIL ${result.label} at ${result.failedStep ?? "unknown step"}\n`);
  process.stdout.write(`${output}\n`);
  if (process.env["GITHUB_ACTIONS"] === "true") {
    process.stdout.write(`::error::${result.label} failed at ${result.failedStep ?? "unknown"}\n`);
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    layout: { type: "string" },
    modules: { type: "string" },
    registry: { type: "string" },
  },
});

const combinations = selectCombinations(values.layout, values.modules);
const scratch = await mkdtemp(join(tmpdir(), "aokit-real-build-"));
const results: CombinationResult[] = [];
for (const combination of combinations) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- one Project at a time keeps logs readable
  const result = await runCombination(combination, {
    exec,
    workspaceRoot,
    projectDirectory: join(scratch, slug(combination)),
    ...(values.registry === undefined ? {} : { registry: resolve(values.registry) }),
    log: (line) => process.stdout.write(`${line}\n`),
  });
  report(result);
  results.push(result);
}

const failed = results.filter((result) => !result.ok);
process.stdout.write(
  `real build: ${results.length - failed.length} passed, ${failed.length} failed\n`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
