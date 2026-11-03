import { stringifySorted } from "./envelope.ts";

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

/**
 * Renders a successful command result for a terminal. A Plan preview prints
 * its unified diffs (`--diff`) or its change list with Provenance
 * (`--dry-run`); any other value prints as indented sorted JSON.
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
  return stringifySorted(data, 2);
}
