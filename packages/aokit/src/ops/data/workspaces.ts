import type { OpVfs } from "../../engine/ops.ts";
import { layoutTables } from "../../engine/layout.ts";
import { mergePackageJson } from "../../patchers/package-json/index.ts";
import { readText, writeIfChanged } from "./files.ts";

const NON_PACKAGE_TARGETS: ReadonlySet<string> = new Set(["root", "config"]);

function baseName(directory: string): string {
  return directory.slice(directory.lastIndexOf("/") + 1);
}

/**
 * Makes a `monorepo` Project a real Bun workspace: every Target directory that holds a
 * `package.json` gets a `name` and `private: true`, and the root `package.json` lists those
 * directories in `workspaces`. Existing values are never replaced, output is sorted, and a
 * `single` Project is left untouched.
 */
export function wireWorkspaces(vfs: OpVfs, layout: "single" | "monorepo"): void {
  if (layout !== "monorepo") {
    return;
  }
  const directories = Object.entries(layoutTables.monorepo)
    .filter(([target, directory]) => !NON_PACKAGE_TARGETS.has(target) && directory !== "")
    .map(([, directory]) => directory)
    .filter((directory) => vfs.has(`${directory}/package.json`))
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  if (directories.length === 0) {
    return;
  }
  for (const directory of directories) {
    const path = `${directory}/package.json`;
    writeIfChanged(
      vfs,
      path,
      mergePackageJson(readText(vfs, path), { name: baseName(directory), private: true }),
    );
  }
  writeIfChanged(
    vfs,
    "package.json",
    mergePackageJson(readText(vfs, "package.json"), { workspaces: directories }),
  );
}
