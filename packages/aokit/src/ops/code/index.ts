import type { OpHandler, OpHandlers } from "../../engine/ops.ts";
import { appendEntry, hasEntryKey, hasEntryText } from "./entries.ts";
import { CodeOpError } from "./errors.ts";
import { addImportEdits } from "./imports.ts";
import { commitEdits, locateSite } from "./resolve.ts";

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
  if (hasEntryText(site, op.element)) {
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
    if (hasEntryKey(site, op.key)) {
      return;
    }
    commitEdits(context, site, (batch) =>
      appendEntry(batch, site, context.module, "object", `${op.key}: ${op.expression}`),
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
  if (hasEntryText(site, op.expression)) {
    return;
  }
  commitEdits(context, site, (batch) =>
    appendEntry(batch, site, context.module, "array", op.expression),
  );
};

/** Handlers for the code Ops `addImport`, `addToArray` and `registerAt`. */
export const codeOpHandlers: OpHandlers = { addImport, addToArray, registerAt };
