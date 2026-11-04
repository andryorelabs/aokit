import { z } from "zod";
import { aokitMeta } from "../cli/meta.ts";

/** Fields only the terminal has a meaning for; the MCP server never exposes them. */
export const cliOnlyFields = ["dryRun", "diff", "yes", "install", "allowDirty"] as const;

function isCliOnly(key: string): boolean {
  return (cliOnlyFields as readonly string[]).includes(key);
}

interface Unwrapped {
  readonly core: z.ZodType;
  readonly optional: boolean;
}

function unwrapField(field: z.ZodType): Unwrapped {
  let core = field;
  let optional = false;
  while (core instanceof z.ZodDefault || core instanceof z.ZodOptional) {
    optional = optional || core instanceof z.ZodOptional;
    const inner: unknown = core.unwrap();
    if (!(inner instanceof z.ZodType)) break;
    core = inner;
  }
  return { core, optional };
}

function toExplicitField(field: z.ZodType): z.ZodType {
  const { core, optional } = unwrapField(field);
  const explicit = optional ? core.nullable() : core;
  const meta = z.globalRegistry.get(field);
  const described = meta === undefined ? explicit : explicit.meta(meta);
  const aokit = aokitMeta.get(field);
  return aokit === undefined ? described : described.register(aokitMeta, aokit);
}

/**
 * Derives the MCP input of a command from its Zod input: defaults are removed, every optional
 * field becomes required and nullable, and the CLI-only fields are dropped, so an agent states
 * every choice explicitly.
 */
export function toExplicitInput(input: z.ZodObject): z.ZodObject {
  const shape = Object.fromEntries(
    Object.entries(input.shape).flatMap(([key, field]) =>
      isCliOnly(key) || !(field instanceof z.ZodType) ? [] : [[key, toExplicitField(field)]],
    ),
  );
  return z.object(shape);
}
