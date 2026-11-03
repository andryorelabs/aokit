import { join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import { AokitError } from "../cli/envelope.ts";
import type { PipelineModule } from "../pipeline/index.ts";
import { readLocalRegistry, type LocalRegistry } from "../registry/index.ts";

const bundledRegistry = join(import.meta.dir, "..", "..", "..", "..", "registry");
const registryIndexMinimum = z.object({ minCliVersion: z.string().min(1) });

/** A loaded Registry with every Module wrapped for the Engine. */
export interface LoadedRegistry {
  readonly registry: LocalRegistry;
  readonly source: string;
  readonly minCliVersion: string;
  readonly available: readonly PipelineModule[];
}

/** Wraps one Registry Module as an Engine Module that reads its files from the Registry. */
function toPipelineModule(name: string, registry: LocalRegistry): PipelineModule {
  const entry = registry.modules.get(name);
  if (entry === undefined) {
    throw new AokitError(
      "INTERNAL",
      `Module ${name} vanished from the Registry`,
      "report the issue",
    );
  }
  return {
    manifest: entry.manifest,
    integrity: entry.integrity,
    readFile(from) {
      const content = entry.files.get(from);
      if (content === undefined) {
        throw new AokitError("INTERNAL", `Module ${name} has no file ${from}`, "report the issue");
      }
      return content;
    },
  };
}

async function readMinCliVersion(registryPath: string): Promise<string> {
  const index: unknown = await Bun.file(join(registryPath, "index.json")).json();
  return registryIndexMinimum.parse(index).minCliVersion;
}

/** Reads the local Registry at `registryFlag`, or the bundled one, and wraps its Modules. */
export async function loadRegistry(
  registryFlag: string | undefined,
  cliVersion: string,
): Promise<LoadedRegistry> {
  const registryPath = registryFlag === undefined ? bundledRegistry : resolvePath(registryFlag);
  const registry = await readLocalRegistry(registryPath, { cliVersion });
  const available = [...registry.modules.keys()]
    .toSorted()
    .map((name) => toPipelineModule(name, registry));
  return {
    registry,
    source: registryFlag ?? "bundled",
    minCliVersion: await readMinCliVersion(registryPath),
    available,
  };
}
