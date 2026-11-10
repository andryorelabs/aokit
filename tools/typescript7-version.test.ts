import { expect, test } from "bun:test";
import { join } from "node:path";

const typescript7CompilerBin = join(
  import.meta.dir,
  "..",
  "node_modules",
  "typescript7",
  "bin",
  "tsc",
);

test("the typescript7 alias bin is TypeScript 7", async () => {
  const versionProcess = Bun.spawn([process.execPath, typescript7CompilerBin, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const versionOutput = await new Response(versionProcess.stdout).text();
  expect(await versionProcess.exited).toBe(0);
  expect(versionOutput.trim()).toStartWith("Version 7.");
});

/**
 * Returns the script commands of a parsed `package.json`, keyed by script name.
 */
function scriptsOf(packageManifest: unknown): Map<string, string> {
  const scripts = new Map<string, string>();
  if (
    typeof packageManifest !== "object" ||
    packageManifest === null ||
    !("scripts" in packageManifest)
  ) {
    return scripts;
  }
  const declaredScripts: unknown = packageManifest.scripts;
  if (typeof declaredScripts !== "object" || declaredScripts === null) {
    return scripts;
  }
  for (const [scriptName, scriptCommand] of Object.entries(declaredScripts)) {
    if (typeof scriptCommand === "string") {
      scripts.set(scriptName, scriptCommand);
    }
  }
  return scripts;
}

test("the typecheck script calls the typescript7 bin by path", async () => {
  const rootManifest: unknown = await Bun.file(join(import.meta.dir, "..", "package.json")).json();
  const scripts = scriptsOf(rootManifest);
  expect(scripts.get("typecheck")).toStartWith("node_modules/typescript7/bin/tsc ");
  for (const scriptCommand of scripts.values()) {
    expect(scriptCommand).not.toMatch(/(^|[\s&|;])tsc(\s|$)/);
  }
});
