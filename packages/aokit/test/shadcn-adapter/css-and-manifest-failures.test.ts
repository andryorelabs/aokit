import { expect, test } from "bun:test";
import { RegistryError } from "../../src/registry/errors.ts";
import { adaptShadcnItem } from "../../src/registry/shadcn/adapt.ts";
import { shadcnItemSchema } from "../../src/registry/shadcn/schema.ts";

function adaptRaw(raw: Record<string, unknown>): unknown {
  return adaptShadcnItem(shadcnItemSchema.parse({ type: "registry:ui", ...raw }), {
    scope: "shadcn",
  });
}

function failure(run: () => unknown): RegistryError {
  try {
    run();
  } catch (error) {
    if (error instanceof RegistryError) return error;
    throw error;
  }
  throw new Error("expected a RegistryError");
}

test("a css rule aokit cannot apply declaratively fails naming the item and the rule", () => {
  const error = failure(() => adaptRaw({ name: "styled", css: { "@media print": {} } }));
  expect(error.code).toBe("REGISTRY_ITEM_UNSUPPORTED");
  expect(error.message).toContain('"styled"');
  expect(error.message).toContain("@media print");
  expect(error.data.module).toBe("styled");
});

test("two files that land on the same destination fail with REGISTRY_PATH_UNSAFE", () => {
  const error = failure(() =>
    adaptRaw({
      name: "twice",
      files: [
        { path: "ui/twice.tsx", type: "registry:ui", content: "export {};\n" },
        { path: "ui/twice.tsx", type: "registry:ui", content: "export {};\n" },
      ],
    }),
  );
  expect(error.code).toBe("REGISTRY_PATH_UNSAFE");
  expect(error.message).toContain("duplicate destination");
});

test("an item whose name cannot form a valid Module name fails with REGISTRY_MANIFEST_INVALID", () => {
  const error = failure(() => adaptRaw({ name: "Not A Valid Name!" }));
  expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
  expect(error.message).toContain("cannot be adapted");
  expect(error.data.module).toBe("Not A Valid Name!");
});
