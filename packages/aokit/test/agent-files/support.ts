import { mkdtempSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { cliVersion } from "../../src/cli/version.ts";

export const context = { version: cliVersion, env: {}, commands: [] };

const workspace = mkdtempSync(join(tmpdir(), "aokit-agent-files-"));
let counter = 0;

export async function cleanWorkspace(): Promise<void> {
  await Promise.all(
    [workspace, ...registryOutputs].map((path) => rm(path, { recursive: true, force: true })),
  );
}

function agentsModuleSource(module: { name: string; version: string; extra: string }): string {
  return `export default {
  name: "${module.name}",
  version: "${module.version}",
  ${module.extra}
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content: "## ${module.name}\\n\\nThe ${module.name} Module is installed.",
    },
  ],
};
`;
}

/** Builds a fixture Registry whose `oxc` and `knip` Modules each contribute an `agents` Region. */
export async function agentsRegistry(): Promise<string> {
  const source = await writeRegistrySourceFixture();
  const out = mkdtempSync(join(tmpdir(), "aokit-agent-registry-"));
  await Promise.all([
    writeFile(
      join(source, "oxc/module.ts"),
      agentsModuleSource({
        name: "oxc",
        version: "1.0.0",
        extra: `provides: ["lint", "format"], files: [{ from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" }],`,
      }),
    ),
    writeFile(
      join(source, "knip/module.ts"),
      agentsModuleSource({
        name: "knip",
        version: "2.1.0",
        extra: `provides: ["unused-code"], requires: ["lint"],`,
      }),
    ),
    mkdir(join(source, "docker"), { recursive: true }).then(() =>
      writeFile(
        join(source, "docker/module.ts"),
        agentsModuleSource({ name: "docker", version: "1.0.0", extra: `provides: ["container"],` }),
      ),
    ),
  ]);
  await buildRegistry(source, out);
  await rm(source, { recursive: true, force: true });
  registryOutputs.push(out);
  return out;
}

const registryOutputs: string[] = [];

export async function createProject(
  registry: string,
  modules: string,
  layout = "single",
): Promise<string> {
  counter += 1;
  const directory = join(workspace, `app-${counter}`);
  const envelope = await runCommand(createCommand, context, {
    directory,
    layout,
    modules,
    registry,
    yes: true,
    install: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  return directory;
}

export async function addModule(directory: string, module: string) {
  return runCommand(addCommand, context, {
    modules: [module],
    directory,
    yes: true,
    install: false,
    allowDirty: true,
  });
}

export async function removeModule(directory: string, module: string) {
  return runCommand(removeCommand, context, {
    module,
    directory,
    yes: true,
    install: false,
    allowDirty: true,
  });
}

export async function updateProject(directory: string) {
  return runCommand(updateCommand, context, {
    directory,
    yes: true,
    install: false,
    allowDirty: true,
  });
}

const doctorShape = z.object({
  files: z.array(z.object({ path: z.string(), state: z.string() })),
});

export async function driftStateOf(directory: string, path: string): Promise<string | undefined> {
  const envelope = await runCommand(doctorCommand, context, { directory });
  return doctorShape.parse(envelope.data).files.find((file) => file.path === path)?.state;
}

export function readText(directory: string, path: string): Promise<string> {
  return readFile(join(directory, path), "utf8");
}

export function writeText(directory: string, path: string, text: string): Promise<void> {
  return writeFile(join(directory, path), text);
}

export async function tree(directory: string, prefix = ""): Promise<Record<string, string>> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const parts = await Promise.all(
    entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map(async (entry): Promise<Record<string, string>> => {
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        return entry.isDirectory()
          ? tree(directory, path)
          : { [path]: await readFile(join(directory, path), "utf8") };
      }),
  );
  return Object.fromEntries(parts.flatMap((part) => Object.entries(part)));
}

export function regionIds(text: string): string[] {
  return [...text.matchAll(/^<!-- aokit:begin (\S+) -->$/gm)].map((match) => match[1] ?? "");
}
