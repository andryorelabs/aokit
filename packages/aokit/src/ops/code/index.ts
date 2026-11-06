import type { OpHandler, OpHandlers } from "../../engine/ops.ts";
import { appendEntry, findEntryByKey, hasEntryText, queuedEntries, sameEntry } from "./entries.ts";
import { CodeOpError } from "./errors.ts";
import { addImportEdits } from "./imports.ts";
import { batchOf, commitEdits, locateSite } from "./resolve.ts";

const addImport: OpHandler = (context, op) => {
  if (op.op !== "addImport") {
    return;
  }
  const site = locateSite(context, op, ["array", "object", "import-list"]);
  commitEdits(context, site, (batch) => addImportEdits(batch, site, context.module, op));
};

const addToArray: OpHandler = (context, op) => {
  if (op.op !== "addToArray") {
    return;
  }
  const site = locateSite(context, op, ["array"]);
  if (hasEntryText(site, op.element, queuedEntries(batchOf(context, site), site))) {
    return;
  }
  commitEdits(context, site, (batch) =>
    appendEntry(batch, site, context.module, "array", op.element),
  );
};

const registerAt: OpHandler = (context, op) => {
  if (op.op !== "registerAt") {
    return;
  }
  const site = locateSite(context, op, ["object", "import-list"]);
  if (site.point.kind === "object") {
    if (op.key === undefined) {
      throw new CodeOpError(
        "ops.invalid-op",
        `registerAt of Module "${context.module}" needs a key for object extension point "${site.point.name}".`,
        context.module,
      );
    }
    const entry = `${op.key}: ${op.expression}`;
    const existing = findEntryByKey(site, op.key, queuedEntries(batchOf(context, site), site));
    if (existing !== undefined) {
      if (sameEntry(existing, entry)) {
        return;
      }
      const registered = context.modulesOf(site.path).filter((name) => name !== context.module);
      const others = registered.length > 0 ? registered : [site.point.module];
      const owners = [...others, context.module].map((name) => `"${name}"`).join(" and ");
      throw new CodeOpError(
        "ops.key-conflict",
        `Modules ${owners} both register key "${op.key}" in ${site.path} for extension point "${site.point.name}" with different values.\n  fix: keep one registration or use distinct keys.`,
        context.module,
      );
    }
    commitEdits(context, site, (batch) =>
      appendEntry(batch, site, context.module, "object", entry),
    );
    return;
  }
  if (op.key !== undefined) {
    throw new CodeOpError(
      "ops.invalid-op",
      `registerAt of Module "${context.module}" must not set a key for import-list extension point "${site.point.name}".`,
      context.module,
    );
  }
  if (hasEntryText(site, op.expression, queuedEntries(batchOf(context, site), site))) {
    return;
  }
  commitEdits(context, site, (batch) =>
    appendEntry(batch, site, context.module, "array", op.expression),
  );
};

/** Handlers for the code Ops `addImport`, `addToArray` and `registerAt`. */
export const codeOpHandlers: OpHandlers = { addImport, addToArray, registerAt };
