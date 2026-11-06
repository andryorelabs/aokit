import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { exposedCommands, hiddenCommands } from "../../packages/aokit/src/cli/commands/registry.ts";
import { errorCodeExitCodes, exitCodes } from "../../packages/aokit/src/cli/exit-codes.ts";

const repoRoot = resolve(import.meta.dir, "../..");
const referencePath = join(repoRoot, "docs/reference/cli.md");

interface ReferenceSources {
  readonly commandNames: readonly string[];
  readonly exitCodeNumbers: readonly number[];
  readonly errorCodes: readonly string[];
  readonly environmentVariables: readonly string[];
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function sourceEnvironmentVariables(): string[] {
  const found = new Set<string>();
  for (const directory of ["packages/aokit/src", "packages/create-aokit/src"]) {
    for (const file of listSourceFiles(join(repoRoot, directory))) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bAOKIT_[A-Z0-9_]+\b/g)) {
        found.add(match[0]);
      }
    }
  }
  return [...found].toSorted();
}

function repositorySources(): ReferenceSources {
  return {
    commandNames: [...exposedCommands, ...hiddenCommands].map((command) => command.name),
    exitCodeNumbers: [...new Set(Object.values(exitCodes))],
    errorCodes: Object.keys(errorCodeExitCodes),
    environmentVariables: sourceEnvironmentVariables(),
  };
}

function hasTableRow(markdown: string, firstCell: string): boolean {
  const prefix = /^\|\s*`([^`]+)`\s*\|/;
  return markdown.split("\n").some((line) => prefix.exec(line)?.[1] === firstCell);
}

function hasHeading(markdown: string, title: string): boolean {
  return markdown.split("\n").includes(`### \`${title}\``);
}

function checkCliReference(markdown: string, sources: ReferenceSources): string[] {
  const problems: string[] = [];
  for (const name of sources.commandNames) {
    if (!hasHeading(markdown, name)) {
      problems.push(`command "${name}" has no "### \`${name}\`" heading`);
    }
  }
  for (const code of sources.exitCodeNumbers) {
    if (!hasTableRow(markdown, String(code))) problems.push(`exit code ${code} has no table row`);
  }
  for (const code of sources.errorCodes) {
    if (!hasTableRow(markdown, code)) problems.push(`error code ${code} has no table row`);
  }
  for (const variable of sources.environmentVariables) {
    if (!hasTableRow(markdown, variable)) problems.push(`env var ${variable} has no table row`);
  }
  return problems;
}

describe("docs/reference/cli.md", () => {
  test("documents every command, exit code, error code and AOKIT_* variable", () => {
    expect(checkCliReference(readFileSync(referencePath, "utf8"), repositorySources())).toEqual([]);
  });

  test("source derivation finds the known inputs", () => {
    const sources = repositorySources();
    expect(sources.commandNames).toContain("layout migrate");
    expect(sources.exitCodeNumbers).toContain(130);
    expect(sources.environmentVariables).toContain("AOKIT_NO_UPDATE_NOTIFIER");
  });
});

describe("cli reference check rejects omissions", () => {
  const complete: ReferenceSources = {
    commandNames: ["create"],
    exitCodeNumbers: [0, 7],
    errorCodes: ["DRIFT"],
    environmentVariables: ["AOKIT_AGENT"],
  };
  const markdown = [
    "### `create`",
    "| `0` | success |",
    "| `7` | new |",
    "| `DRIFT` | `1` |",
    "| `AOKIT_AGENT` | x |",
  ].join("\n");

  test("a complete page passes", () => {
    expect(checkCliReference(markdown, complete)).toEqual([]);
  });

  test("a new exit code without a row fails", () => {
    expect(checkCliReference(markdown, { ...complete, exitCodeNumbers: [0, 7, 8] })).toEqual([
      "exit code 8 has no table row",
    ]);
  });

  test("a new error code, command and env var without rows fail", () => {
    expect(
      checkCliReference(markdown, {
        commandNames: ["create", "ship"],
        exitCodeNumbers: [0],
        errorCodes: ["DRIFT", "NEW_CODE"],
        environmentVariables: ["AOKIT_AGENT", "AOKIT_NEW"],
      }),
    ).toEqual([
      'command "ship" has no "### `ship`" heading',
      "error code NEW_CODE has no table row",
      "env var AOKIT_NEW has no table row",
    ]);
  });
});
