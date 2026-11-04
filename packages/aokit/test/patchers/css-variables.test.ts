import { expect, test } from "bun:test";
import { addCssVariables } from "../../src/patchers/postcss/index.ts";

const source = `@import "tailwindcss";

/* user */
.card { color: red; }
`;

test("addCssVariables creates groups, keeps existing values and is idempotent", () => {
  const patch = { group: "light" as const, variables: { "--background": "white", ring: "1px" } };
  const once = addCssVariables(source, patch);
  expect(once).toContain(":root {");
  expect(once).toContain("--ring: 1px");
  expect(addCssVariables(once, patch)).toBe(once);
  const kept = addCssVariables(once, { ...patch, variables: { "--background": "red" } });
  expect(kept).toContain("--background: white");
  const replaced = addCssVariables(once, {
    ...patch,
    variables: { "--background": "red" },
    overwrite: true,
  });
  expect(replaced).toContain("--background: red");
  expect(replaced).toContain("/* user */");
});

test("addCssVariables targets @theme, :root and .dark", () => {
  let css = addCssVariables(source, { group: "theme", variables: { "--radius": "1rem" } });
  css = addCssVariables(css, { group: "dark", variables: { "--background": "black" } });
  expect(css).toMatch(/@theme \{\s*--radius: 1rem;?\s*\}/);
  expect(css).toMatch(/\.dark \{\s*--background: black;?\s*\}/);
});
