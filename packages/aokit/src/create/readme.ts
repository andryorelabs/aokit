import { basename } from "node:path";
import { legacyManifestDescription, type ModuleManifest } from "@aokit/module";
import { type Plan, hashVfs } from "../engine/plan.ts";

const readmePath = "README.md";

/** One selected Module as the README lists it. */
interface ReadmeModule {
  readonly name: string;
  readonly description: string;
}

/** Inputs of {@link renderProjectReadme}. */
interface ReadmeInput {
  readonly name: string;
  readonly modules: readonly ReadmeModule[];
  /** The `scripts` of the generated `package.json`, by name. */
  readonly scripts: Readonly<Record<string, string>>;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function moduleLine(module: ReadmeModule): string {
  return module.description === ""
    ? `- \`${module.name}\``
    : `- \`${module.name}\`: ${module.description}`;
}

function scriptLines(scripts: Readonly<Record<string, string>>): string[] {
  const names = Object.keys(scripts).toSorted(compare);
  if (names.length === 0) {
    return [];
  }
  return [
    "## Scripts",
    "",
    ...names.map((name) => `- \`bun run ${name}\`: \`${scripts[name]}\``),
    "",
  ];
}

/**
 * Renders the minimal `README.md` of a new Project: its name, the selected Modules with their
 * descriptions, the scripts of its `package.json` and how to keep it in sync with `aokit`. The
 * output depends only on its input, so it is deterministic.
 */
export function renderProjectReadme(input: ReadmeInput): string {
  const modules = input.modules.toSorted((left, right) => compare(left.name, right.name));
  const lines = [
    `# ${input.name}`,
    "",
    "Created with aokit.",
    "",
    "## Modules",
    "",
    ...modules.map(moduleLine),
    "",
    ...scriptLines(input.scripts),
    "## Keeping it up to date",
    "",
    "- `aokit update` applies newer versions of the Modules above.",
    "- `aokit check` reports files that drifted from what the Modules generated.",
    "",
  ];
  return lines.join("\n");
}

function scriptsOf(plan: Plan): Record<string, string> {
  const content = plan.vfs.read("package.json");
  if (typeof content !== "string") {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || !("scripts" in parsed)) {
    return {};
  }
  const { scripts } = parsed;
  if (scripts === null || typeof scripts !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * Adds the core `README.md` to a Plan of a new Project unless a Module already provides one. The
 * file is a seed owned by no Module, so the Lockfile never tracks it and `update` never touches it.
 */
export function withProjectReadme(
  plan: Plan,
  directory: string,
  manifests: readonly ModuleManifest[],
): Plan {
  if (plan.vfs.has(readmePath)) {
    return plan;
  }
  const content = renderProjectReadme({
    name: basename(directory),
    modules: manifests.map((manifest) => ({
      name: manifest.name,
      description: manifest.description === legacyManifestDescription ? "" : manifest.description,
    })),
    scripts: scriptsOf(plan),
  });
  const vfs = plan.vfs.clone();
  vfs.write(readmePath, content, { ownership: "seed" });
  const changes = [
    ...plan.changes,
    {
      type: "create" as const,
      path: readmePath,
      content,
      ownership: "seed" as const,
      mode: undefined,
      provenance: [],
    },
  ].toSorted((left, right) => compare(left.path, right.path));
  return { changes, hash: hashVfs(vfs), vfs };
}
