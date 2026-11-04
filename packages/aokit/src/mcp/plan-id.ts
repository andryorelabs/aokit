import { createHash } from "node:crypto";
import { stringifySorted } from "../cli/envelope.ts";

/** The `planId`s the server issued in this session; it lives as long as the server process. */
export interface PlanSession {
  issue(planId: string): void;
  has(planId: string): boolean;
  consume(planId: string): void;
}

/** A session with no `planId` issued yet, so a Plan never survives a server restart. */
export function createPlanSession(): PlanSession {
  const issued = new Set<string>();
  return {
    issue(planId) {
      issued.add(planId);
    },
    has(planId) {
      return issued.has(planId);
    },
    consume(planId) {
      issued.delete(planId);
    },
  };
}

/**
 * Hashes the normalized input (keys sorted at every level), the resolved Release and the Plan's
 * VFS hash, so any change to one of them yields a different `planId`.
 */
export function computePlanId(input: unknown, release: string, vfsHash: string): string {
  const digest = createHash("sha256")
    .update(stringifySorted({ input, release, vfsHash }))
    .digest("hex");
  return `plan_${digest}`;
}
