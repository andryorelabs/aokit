import { z } from "zod";

/**
 * The Catalog a Registry release ships: dependency name to version, plus Toolchain pin groups.
 * A pin group lists the dependency names that move together and are pinned exactly.
 */
export const catalogSchema = z
  .strictObject({
    dependencies: z.record(z.string().min(1), z.string().min(1)),
    pinGroups: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
  })
  .superRefine((catalog, context) => {
    for (const [group, members] of Object.entries(catalog.pinGroups)) {
      for (const member of members) {
        if (!(member in catalog.dependencies)) {
          context.addIssue({
            code: "custom",
            path: ["pinGroups", group],
            message: `pin group "${group}" lists "${member}", which is not in dependencies`,
          });
        }
      }
    }
  });

export type Catalog = z.output<typeof catalogSchema>;
export type CatalogInput = z.input<typeof catalogSchema>;
