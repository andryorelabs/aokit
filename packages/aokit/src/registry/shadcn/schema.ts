import { z } from "zod";

const itemName = z.string().min(1);

const stringMap = z.record(z.string(), z.string());

const itemFile = z.object({
  path: z.string().min(1),
  type: z.string().optional(),
  target: z.string().min(1).optional(),
  content: z.string(),
});

/**
 * One item of a shadcn registry. Only the fields the adapter reads are declared; any other field
 * is dropped at parse time, so an item can never carry data that influences trust.
 */
export const shadcnItemSchema = z.object({
  name: itemName,
  type: z.string().min(1),
  dependencies: z.array(z.string().min(1)).default([]),
  devDependencies: z.array(z.string().min(1)).default([]),
  registryDependencies: z.array(z.string().min(1)).default([]),
  files: z.array(itemFile).default([]),
  cssVars: z
    .object({
      theme: stringMap.optional(),
      light: stringMap.optional(),
      dark: stringMap.optional(),
    })
    .optional(),
  css: z.record(z.string(), z.json()).optional(),
  envVars: stringMap.optional(),
});

/**
 * A validated shadcn registry item.
 */
export type ShadcnItem = z.output<typeof shadcnItemSchema>;

/**
 * The shadcn `registry.json` index: the list of items a registry serves.
 */
export const shadcnRegistrySchema = z.object({
  name: z.string().min(1).optional(),
  homepage: z.string().min(1).optional(),
  items: z.array(z.object({ name: itemName, type: z.string().min(1) })),
});
