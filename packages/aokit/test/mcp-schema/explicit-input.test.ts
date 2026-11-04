import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { aokitMeta } from "../../src/cli/meta.ts";
import { cliOnlyFields, fromExplicitInput, toExplicitInput } from "../../src/mcp/explicit-input.ts";

const commands = [createCommand, addCommand, removeCommand, updateCommand];

function shapeOf(schema: z.ZodObject): Record<string, z.ZodType> {
  return Object.fromEntries(
    Object.entries(schema.shape).flatMap(([key, field]) =>
      field instanceof z.ZodType ? [[key, field]] : [],
    ),
  );
}

function fieldOf(schema: z.ZodObject, key: string): z.ZodType {
  const field = shapeOf(schema)[key];
  if (field === undefined) throw new Error(`missing field ${key}`);
  return field;
}

describe("toExplicitInput", () => {
  test("removes defaults, requires optional fields as nullable and drops CLI-only fields", () => {
    const explicit = toExplicitInput(
      z.object({
        directory: z.string().default("app"),
        layout: z.enum(["single", "monorepo"]).optional(),
        trust: z.array(z.string()).default([]),
        dryRun: z.boolean().default(false),
        install: z.boolean().default(true),
      }),
    );
    expect(Object.keys(explicit.shape)).toEqual(["directory", "layout", "trust"]);
    expect(explicit.safeParse({}).success).toBe(false);
    expect(explicit.safeParse({ directory: "/a", layout: null, trust: [] }).success).toBe(true);
    expect(explicit.safeParse({ directory: "/a", layout: null, trust: null }).success).toBe(true);
    expect(explicit.safeParse({ directory: null, layout: null, trust: [] }).success).toBe(false);
    expect(z.toJSONSchema(explicit, { io: "input" }).required).toEqual([
      "directory",
      "layout",
      "trust",
    ]);
  });

  test("a list with a default is nullable and null falls back to the CLI default", () => {
    const cli = z.object({ trust: z.array(z.string()).default([]), name: z.string().default("a") });
    const explicit = toExplicitInput(cli);
    const sent = { trust: null, name: "b" };
    expect(explicit.safeParse(sent).success).toBe(true);
    expect(explicit.safeParse({ trust: [], name: null }).success).toBe(false);
    expect(cli.parse(fromExplicitInput(sent))).toEqual({ trust: [], name: "b" });
  });

  test("keeps the description and aokit meta of the CLI field", () => {
    const original = fieldOf(createCommand.input, "modules");
    const field = fieldOf(toExplicitInput(createCommand.input), "modules");
    expect(field.description).toBe(original.description);
    expect(aokitMeta.get(field)).toEqual(aokitMeta.get(original));
  });

  test("a field added to the create input is required in the MCP schema", () => {
    const extended = createCommand.input.extend({ fresh: z.string().optional() });
    const document = z.toJSONSchema(toExplicitInput(extended), { io: "input" });
    expect(document.required).toContain("fresh");
  });

  test("lists the CLI-only fields", () => {
    expect(cliOnlyFields).toEqual(["dryRun", "diff", "yes", "install", "allowDirty"]);
  });
});

describe("explicit input drift", () => {
  for (const command of commands) {
    test(`every ${command.name} field is in the MCP schema or the CLI-only list`, () => {
      const explicit = shapeOf(toExplicitInput(command.input));
      const cliOnly: readonly string[] = cliOnlyFields;
      const unaccounted = Object.keys(shapeOf(command.input)).filter(
        (key) => !(key in explicit) && !cliOnly.includes(key),
      );
      expect(unaccounted).toEqual([]);
    });

    test(`${command.name} MCP schema requires every property`, () => {
      const document = z.toJSONSchema(toExplicitInput(command.input), {
        io: "input",
      });
      expect(document.required ?? []).toEqual(Object.keys(document.properties ?? {}));
    });
  }

  test("a CLI-only field is dropped from the MCP schema", () => {
    const explicit = shapeOf(toExplicitInput(z.object({ yes: z.boolean().default(false) })));
    expect("yes" in explicit).toBe(false);
  });
});
