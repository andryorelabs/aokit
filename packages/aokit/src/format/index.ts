import { createRequire } from "node:module";
import type { Catalog, ModuleManifest } from "@aokit/module";
import { format } from "oxfmt";
import { z } from "zod";
import type { Formatter, Vfs } from "../engine/index.ts";
import { optionsFor, readProjectConfigs } from "./config.ts";
import { FormatError } from "./errors.ts";

export { FormatError } from "./errors.ts";

const pinGroup = "oxc";
const packageName = "oxfmt";
const formatCapability = "format";
const unsupportedPrefix = "Unsupported file type";
const installedManifestSchema = z.object({ version: z.string().min(1) });

/** Options of {@link createOxfmtFormatter}. */
export interface OxfmtFormatterOptions {
  readonly catalog: Catalog;
}

function installedOxfmtVersion(): string {
  const manifest: unknown = createRequire(import.meta.url)(`${packageName}/package.json`);
  return installedManifestSchema.parse(manifest).version;
}

function assertPinnedVersion(catalog: Catalog): void {
  const pinned = catalog.dependencies[packageName];
  if (pinned === undefined || !(catalog.pinGroups[pinGroup] ?? []).includes(packageName)) {
    throw new FormatError(
      "format.catalog-missing-oxfmt",
      `The Catalog's "${pinGroup}" pin group does not list "${packageName}".`,
      `Add "${packageName}" to the Catalog dependencies and to pin group "${pinGroup}".`,
    );
  }
  const installed = installedOxfmtVersion();
  if (pinned !== installed) {
    throw new FormatError(
      "format.version-mismatch",
      `Installed ${packageName} ${installed} differs from the Catalog "${pinGroup}" pin ${pinned}.`,
      `Use an aokit release whose ${packageName} is ${pinned}, or a Catalog that pins ${packageName} ${installed}.`,
    );
  }
}

async function formatFile(
  path: string,
  source: string,
  options: Parameters<typeof format>[2],
): Promise<string> {
  const result = await format(path, source, options);
  const errors = result.errors.filter((error) => {
    const severity: string = error.severity;
    return severity === "Error";
  });
  if (errors.length === 0) {
    return result.code;
  }
  if (errors.every((error) => error.message.startsWith(unsupportedPrefix))) {
    return source;
  }
  const details = errors.map((error) => error.codeframe ?? error.message).join("\n");
  throw new FormatError(
    "format.failed",
    `Oxfmt could not format "${path}":\n${details}`,
    `Fix the syntax error in "${path}" in the Module that writes it.`,
  );
}

/**
 * The pinned format phase: formats every VFS file Oxfmt supports, in process, honoring the
 * Project's `.oxfmtrc.json`. Unsupported and binary files are left untouched. Fails at creation when
 * the installed `oxfmt` differs from the Catalog's `oxc` pin.
 */
export function createOxfmtFormatter(options: OxfmtFormatterOptions): Formatter {
  assertPinnedVersion(options.catalog);
  return {
    name: packageName,
    async format(vfs: Vfs): Promise<Vfs> {
      const configs = readProjectConfigs(vfs);
      const paths = vfs.paths();
      const formatted = await Promise.all(
        paths.map(async (path) => {
          const source = vfs.read(path);
          const fileOptions = optionsFor(path, configs);
          if (typeof source !== "string" || fileOptions === undefined) {
            return undefined;
          }
          return formatFile(path, source, fileOptions);
        }),
      );
      const next = vfs.clone();
      paths.forEach((path, index) => {
        const code = formatted[index];
        if (code !== undefined && code !== vfs.read(path)) {
          next.write(path, code);
        }
      });
      return next;
    },
  };
}

/** The Oxfmt Formatter when a selected Module provides `format`; otherwise none. */
export function formatterForSelection(input: {
  readonly catalog: Catalog;
  readonly modules: readonly ModuleManifest[];
}): Formatter | undefined {
  const providesFormat = input.modules.some((manifest) =>
    manifest.provides.some((entry) => entry.capability === formatCapability),
  );
  return providesFormat ? createOxfmtFormatter({ catalog: input.catalog }) : undefined;
}
