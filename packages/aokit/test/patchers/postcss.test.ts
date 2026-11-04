import { expect, test } from "bun:test";
import { addCssAtRule } from "../../src/patchers/postcss/index.ts";

const source = `@import "tailwindcss";

/* user */
.card { color: red; }
`;

test("addCssAtRule adds imports after existing imports and plugins after them", () => {
  let css = addCssAtRule(source, { name: "plugin", params: '"@tailwindcss/typography"' });
  css = addCssAtRule(css, { name: "import", params: '"tw-animate-css"' });
  expect(css.indexOf("tw-animate-css")).toBeLessThan(css.indexOf("@plugin"));
  expect(css.indexOf("@plugin")).toBeLessThan(css.indexOf(".card"));
  expect(css).toContain("/* user */");
});

test("addCssAtRule merges @theme declarations without duplicating", () => {
  const rule = { name: "theme", declarations: { "--color-brand": "#fff" } };
  const once = addCssAtRule(source, rule);
  const twice = addCssAtRule(once, {
    ...rule,
    declarations: { ...rule.declarations, "--font-sans": "Inter" },
  });
  expect(twice.match(/@theme/g)?.length).toBe(1);
  expect(twice.match(/--color-brand/g)?.length).toBe(1);
  expect(twice).toContain("--font-sans");
  expect(addCssAtRule(twice, rule)).toBe(twice);
});

test("addCssAtRule is idempotent for imports and plugins", () => {
  const rule = { name: "plugin", params: '"x"' };
  const once = addCssAtRule(source, rule);
  expect(addCssAtRule(once, rule)).toBe(once);
});

test("addCssAtRule nested rules stay idempotent after the file is reformatted", () => {
  const patch = {
    name: "layer",
    params: "base",
    block: "* { @apply border-border; } body { @apply bg-background; }",
  };
  const once = addCssAtRule(source, patch);
  const reformatted = once.replace(
    "* { @apply border-border; }",
    "*\n  {\n    @apply border-border;\n  }",
  );
  expect(reformatted).not.toBe(once);
  expect(addCssAtRule(reformatted, patch)).toBe(reformatted);
});
