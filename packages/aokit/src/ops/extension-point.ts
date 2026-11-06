import type { DeclaredExtensionPoint, OpContext } from "../engine/ops.ts";

/** Reports a failed Extension point resolution; each Op family raises its own error type. */
export type ExtensionPointFailure = (
  code: "extension-point-missing" | "extension-point-range",
  message: string,
) => never;

/** Finds the Extension point `name` and checks that its version satisfies `range`. */
export function resolveExtensionPoint(
  context: OpContext,
  name: string,
  range: string,
  fail: ExtensionPointFailure,
): DeclaredExtensionPoint {
  const point = context.extensionPoints.get(name);
  if (!point) {
    return fail(
      "extension-point-missing",
      `Module "${context.module}" uses extension point "${name}@${range}" but no selected Module declares it.\n  fix: select the Module that declares "${name}".`,
    );
  }
  if (!Bun.semver.satisfies(point.version, range)) {
    return fail(
      "extension-point-range",
      `Module "${context.module}" requires extension point "${name}@${range}" but "${point.module}" provides ${point.version}.\n  fix: use a ${context.module} release that supports ${name}@${point.version}, or update ${point.module}.`,
    );
  }
  return point;
}
