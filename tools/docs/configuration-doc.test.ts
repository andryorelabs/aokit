import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

const envAccessPattern = /\b(?:env|process\.env)(?:\.|\[\s*")([A-Z][A-Z0-9_]*)\b/g;
const directoryRulePattern = /\b(?:xdgVariable|windowsVariable):\s*"([A-Z][A-Z0-9_]*)"/g;
const aokitNamePattern = /\bAOKIT_[A-Z0-9_]+\b/g;
const agentListPattern = /agentVariables\s*=\s*\[([^\]]*)\]/g;
const quotedNamePattern = /"([A-Z][A-Z0-9_]*)"/g;

function listSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    const isSource = entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts");
    return isSource ? [full] : [];
  });
}

function packageSourceFiles(): string[] {
  const packagesDirectory = join(repoRoot, "packages");
  return readdirSync(packagesDirectory).flatMap((name) =>
    listSourceFiles(join(packagesDirectory, name, "src")),
  );
}

function namesIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? match[0]);
}

function agentListNames(text: string): string[] {
  return [...text.matchAll(agentListPattern)].flatMap((match) =>
    namesIn(match[1] ?? "", quotedNamePattern),
  );
}

/** Every environment variable name the package sources read. */
function environmentVariablesRead(files: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const names = [
      ...namesIn(text, envAccessPattern),
      ...namesIn(text, directoryRulePattern),
      ...namesIn(text, aokitNamePattern),
      ...agentListNames(text),
    ];
    for (const name of names) {
      if (!found.has(name)) found.set(name, file.slice(repoRoot.length + 1));
    }
  }
  return found;
}

function documentedNames(document: string): Set<string> {
  return new Set([...document.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((match) => match[1] ?? ""));
}

function missingFromDocument(read: ReadonlyMap<string, string>, document: string): string[] {
  const documented = documentedNames(document);
  return [...read]
    .filter(([name]) => !documented.has(name))
    .map(([name, file]) => `${name} (${file})`);
}

describe("docs/configuration.md", () => {
  const document = readFileSync(join(repoRoot, "docs/configuration.md"), "utf8");

  test("documents every environment variable read in packages/*/src", () => {
    const read = environmentVariablesRead(packageSourceFiles());
    expect(read.has("AOKIT_AGENT")).toBe(true);
    expect(read.has("XDG_CACHE_HOME")).toBe(true);
    expect(missingFromDocument(read, document)).toEqual([]);
  });

  test("flags a variable that has no row", () => {
    const read = new Map([["AOKIT_NOT_DOCUMENTED", "packages/aokit/src/example.ts"]]);
    expect(missingFromDocument(read, document)).toEqual([
      "AOKIT_NOT_DOCUMENTED (packages/aokit/src/example.ts)",
    ]);
  });
});
