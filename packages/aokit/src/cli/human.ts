import { isDiagnosticData, stringifySorted } from "./envelope.ts";

interface PlanPreview {
  applied: false;
  diff?: string;
  plan: {
    changes: {
      type: string;
      path: string;
      provenance: { module: string }[];
    }[];
  };
}

function isPlanPreview(data: unknown): data is PlanPreview {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const candidate = data as { applied?: unknown; plan?: { changes?: unknown } };
  return candidate.applied === false && Array.isArray(candidate.plan?.changes);
}

interface ModuleList {
  byCapability: Record<string, { name: string; version: string; description: string }[]>;
}

function isModuleList(data: unknown): data is ModuleList {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const candidate = data as { modules?: unknown; byCapability?: unknown };
  return (
    Array.isArray(candidate.modules) &&
    typeof candidate.byCapability === "object" &&
    candidate.byCapability !== null
  );
}

function renderModuleList(list: ModuleList): string {
  return Object.entries(list.byCapability)
    .map(([capability, entries]) =>
      [
        capability,
        ...entries.map(
          (entry) =>
            `  ${entry.name}@${entry.version}${entry.description === "" ? "" : `  ${entry.description}`}`,
        ),
      ].join("\n"),
    )
    .join("\n\n");
}

/**
 * Renders the report an outcome error (`DRIFT`, `UPDATE_AVAILABLE`) carries
 * next to its message; empty when the failure has no report. Diagnostic data (see
 * `asDiagnosticData`) prints only when `verbose` is set.
 */
export function renderFailureReport(data: unknown, verbose = false): string {
  if (data === null || data === undefined) {
    return "";
  }
  return isDiagnosticData(data) && !verbose ? "" : renderHuman(data);
}

/**
 * Renders a successful command result for a terminal. A Plan preview prints
 * its unified diffs (`--diff`) or its change list with Provenance
 * (`--dry-run`); a Module list prints grouped by Capability; any other value prints as indented sorted JSON.
 */
export function renderHuman(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (isPlanPreview(data)) {
    if (data.diff !== undefined) {
      return data.diff;
    }
    return data.plan.changes
      .map((change) => {
        const modules = change.provenance.map((entry) => entry.module).join(", ");
        return `${change.type} ${change.path}${modules === "" ? "" : ` (${modules})`}`;
      })
      .join("\n");
  }
  if (isModuleList(data)) {
    return renderModuleList(data);
  }
  return stringifySorted(data, 2);
}
