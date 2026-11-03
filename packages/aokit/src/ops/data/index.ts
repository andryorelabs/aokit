import type { Op } from "@aokit/module";
import { EngineError } from "../../engine/errors.ts";
import type { OpHandler, OpHandlers } from "../../engine/ops.ts";
import { addEnv } from "../../patchers/env/index.ts";
import { mergeJsonc } from "../../patchers/jsonc/index.ts";
import { appendRegion } from "../../patchers/markdown/index.ts";
import { addCssAtRule } from "../../patchers/postcss/index.ts";
import { mergeYaml } from "../../patchers/yaml/index.ts";
import { readText, writeIfChanged } from "./files.ts";

export { applyDeps } from "./deps.ts";
export { applyEnv } from "./env.ts";

type OpContext = Parameters<OpHandler>[0];

function editFile(
  context: OpContext,
  target: Op["target"],
  file: string,
  edit: (text: string) => string,
): void {
  const path = context.resolvePath(target, file);
  writeIfChanged(context.vfs, path, edit(readText(context.vfs, path)));
}

function mismatch(context: OpContext, expected: string, received: string): never {
  throw new EngineError(
    "engine.unknown-op",
    `Handler for "${expected}" received "${received}" in Module "${context.module}".`,
    [context.module],
  );
}

function parseDeclarations(body: string | undefined): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of (body ?? "").split(/[;\n]/)) {
    const separator = part.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const property = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (property !== "" && value !== "") {
      declarations[property] = value;
    }
  }
  return declarations;
}

/** Handlers for the data Ops (`mergeJson`, `mergeYaml`, `addEnv`, `addCssAtRule`, `appendRegion`). */
export const dataOpHandlers: OpHandlers = {
  mergeJson(context, op) {
    if (op.op !== "mergeJson") {
      mismatch(context, "mergeJson", op.op);
    }
    editFile(context, op.target, op.file, (text) => mergeJsonc(text, op.value));
  },
  mergeYaml(context, op) {
    if (op.op !== "mergeYaml") {
      mismatch(context, "mergeYaml", op.op);
    }
    editFile(context, op.target, op.file, (text) => mergeYaml(text, op.value));
  },
  addEnv(context, op) {
    if (op.op !== "addEnv") {
      mismatch(context, "addEnv", op.op);
    }
    editFile(context, op.target, op.file ?? ".env", (text) => addEnv(text, op.entries));
  },
  addCssAtRule(context, op) {
    if (op.op !== "addCssAtRule") {
      mismatch(context, "addCssAtRule", op.op);
    }
    const declarations = parseDeclarations(op.body);
    editFile(context, op.target, op.file, (text) =>
      addCssAtRule(text, {
        name: op.rule,
        params: op.params,
        ...(Object.keys(declarations).length > 0 ? { declarations } : {}),
      }),
    );
  },
  appendRegion(context, op) {
    if (op.op !== "appendRegion") {
      mismatch(context, "appendRegion", op.op);
    }
    editFile(context, op.target, op.file, (text) =>
      appendRegion(text, { module: `${context.module}:${op.region}`, content: op.content }),
    );
  },
};
