import type { Op } from "@aokit/module";
import { parseSync } from "oxc-parser";
import type { EditBatch } from "../../edit/batch.ts";
import { queuedImport } from "./queued.ts";
import type { AnchorSite } from "./resolve.ts";

type AddImport = Extract<Op, { op: "addImport" }>;

interface ExistingImport {
  readonly defaultName: string | undefined;
  readonly namespaceName: string | undefined;
  readonly named: readonly string[];
  readonly lastNamedEnd: number | undefined;
}

function existingImports(site: AnchorSite, from: string): ExistingImport[] {
  const { program } = parseSync(site.path, site.source, { lang: "ts" });
  return program.body.flatMap((statement) => {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== from ||
      statement.importKind === "type"
    ) {
      return [];
    }
    let defaultName: string | undefined;
    let namespaceName: string | undefined;
    const named: string[] = [];
    let lastNamedEnd: number | undefined;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportDefaultSpecifier") {
        defaultName = specifier.local.name;
      } else if (specifier.type === "ImportNamespaceSpecifier") {
        namespaceName = specifier.local.name;
      } else {
        named.push(site.source.slice(specifier.start, specifier.end));
        lastNamedEnd = specifier.end;
      }
    }
    return [{ defaultName, namespaceName, named, lastNamedEnd }];
  });
}

function statementText(
  from: string,
  defaultName: string | undefined,
  named: readonly string[],
): string {
  const clauses = [
    ...(defaultName ? [defaultName] : []),
    ...(named.length > 0 ? [`{ ${named.join(", ")} }`] : []),
  ];
  return `import ${clauses.join(", ")} from ${JSON.stringify(from)};`;
}

/** Adds the missing parts of an import; adds nothing when everything is already imported. */
export function addImportEdits(
  batch: EditBatch,
  site: AnchorSite,
  module: string,
  op: AddImport,
): void {
  const existing = existingImports(site, op.from);
  const queued = queuedImport(batch, op.from);
  const present = new Set([...existing.flatMap((entry) => entry.named), ...queued.named]);
  const missingNamed = (op.named ?? []).filter((name) => !present.has(name));
  const hasDefault = queued.hasDefault || existing.some((entry) => entry.defaultName !== undefined);
  const hasNamespace =
    queued.hasNamespace || existing.some((entry) => entry.namespaceName !== undefined);
  const missingDefault = op.default !== undefined && !hasDefault ? op.default : undefined;
  const missingNamespace = op.namespace !== undefined && !hasNamespace ? op.namespace : undefined;
  for (const name of missingNamed) {
    queued.named.add(name);
  }
  queued.hasDefault ||= missingDefault !== undefined;
  queued.hasNamespace ||= missingNamespace !== undefined;

  const host = existing.find((entry) => entry.lastNamedEnd !== undefined);
  let remainingNamed = missingNamed;
  if (host?.lastNamedEnd !== undefined && missingNamed.length > 0) {
    batch.insert(module, host.lastNamedEnd, `, ${missingNamed.join(", ")}`);
    remainingNamed = [];
  }

  const lines: string[] = [];
  if (missingDefault !== undefined || remainingNamed.length > 0) {
    lines.push(statementText(op.from, missingDefault, remainingNamed));
  }
  if (missingNamespace !== undefined) {
    lines.push(`import * as ${missingNamespace} from ${JSON.stringify(op.from)};`);
  }
  if (lines.length === 0) {
    return;
  }
  const offset = site.parsed.imports.at(-1)?.span.end ?? 0;
  const body = lines.join("\n");
  batch.insert(module, offset, offset === 0 ? `${body}\n` : `\n${body}`);
}
