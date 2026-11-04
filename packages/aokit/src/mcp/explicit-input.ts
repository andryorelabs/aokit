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
  readonly defaulted: boolean;
}

function unwrapField(field: z.ZodType): Unwrapped {
  let core = field;
  let optional = false;
  let defaulted = false;
  while (core instanceof z.ZodDefault || core instanceof z.ZodOptional) {
    optional = optional || core instanceof z.ZodOptional;
    defaulted = defaulted || core instanceof z.ZodDefault;
    const inner: unknown = core.unwrap();
    if (!(inner instanceof z.ZodType)) break;
    core = inner;
  }
  return { core, optional, defaulted };
}

function toExplicitField(field: z.ZodType): z.ZodType {
  const { core, optional, defaulted } = unwrapField(field);
  const noneIsAnAnswer = optional || (defaulted && core instanceof z.ZodArray);
  const explicit = noneIsAnAnswer ? core.nullable() : core;
  const meta = z.globalRegistry.get(field);
  const described = meta === undefined ? explicit : explicit.meta(meta);
  const aokit = aokitMeta.get(field);
  return aokit === undefined ? described : described.register(aokitMeta, aokit);
}

/**
 * Derives the MCP input of a command from its Zod input: defaults are removed, every optional
 * field and every list with a default becomes required and nullable (`null` means "none"), and
 * the CLI-only fields are dropped, so an agent states every choice explicitly. Scalar fields
 * with a default stay required and non-null.
 */
export function toExplicitInput(input: z.ZodObject): z.ZodObject {
  const shape = Object.fromEntries(
    Object.entries(input.shape).flatMap(([key, field]) =>
      isCliOnly(key) || !(field instanceof z.ZodType) ? [] : [[key, toExplicitField(field)]],
    ),
  );
  return z.object(shape);
}

/**
 * Turns an explicit MCP input back into a command input by dropping every `null`, so an optional
 * field is left unset and a list falls back to its empty default.
 */
export function fromExplicitInput(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
}
