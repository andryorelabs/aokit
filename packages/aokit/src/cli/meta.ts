import { z } from "zod";

/**
 * Presentation details that Zod does not carry. Registered next to a schema
 * field so the schema stays plain Zod.
 */
export interface AokitMeta {
  /** Long flag name; defaults to the kebab-cased key. */
  flag?: string;
  /** Single-letter alias. */
  alias?: string;
  /** Position among positional arguments. */
  positional?: number;
  /** How the interactive surface asks. */
  prompt?: {
    type: "text" | "select" | "multiselect" | "confirm";
    message: string;
  };
  /** Help section and prompt group. */
  group?: string;
  /** Omitted from help, prompts and web UI; still accepted. */
  hidden?: boolean;
  /** Real example values, reused by help and tool descriptions. */
  examples?: string[];
}

export const aokitMeta = z.registry<AokitMeta>();
