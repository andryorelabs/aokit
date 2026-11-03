import { atRule, decl, parse, type AtRule, type Root } from "postcss";

/** A Tailwind v4 at-rule to add: `@import`, `@plugin` (with params) or `@theme` (with declarations). */
export interface CssAtRulePatch {
  readonly name: string;
  readonly params?: string;
  readonly declarations?: Readonly<Record<string, string>>;
}

const HEADER_RULES: readonly string[] = ["import", "plugin"];

function headerRank(name: string): number {
  return HEADER_RULES.indexOf(name);
}

function sameRule(node: AtRule, patch: CssAtRulePatch): boolean {
  return node.name === patch.name && node.params === (patch.params ?? "");
}

function insertHeaderRule(root: Root, patch: CssAtRulePatch) {
  const rule = atRule({ name: patch.name, params: patch.params ?? "" });
  const rank = headerRank(patch.name);
  let anchor: AtRule | undefined;
  root.walkAtRules((node) => {
    const nodeRank = headerRank(node.name);
    if (node.parent === root && nodeRank !== -1 && nodeRank <= rank) anchor = node;
  });
  if (anchor) {
    rule.raws.before = "\n";
    root.insertAfter(anchor, rule);
    return;
  }
  rule.raws.before = "";
  root.prepend(rule);
  const next = rule.next();
  if (next && !next.raws.before?.includes("\n\n")) next.raws.before = "\n\n";
}

function mergeBlockRule(root: Root, patch: CssAtRulePatch) {
  const declarations = Object.entries(patch.declarations ?? {});
  let block: AtRule | undefined;
  root.walkAtRules(patch.name, (node) => {
    if (node.parent === root && node.params === (patch.params ?? "")) block ??= node;
  });
  if (!block) {
    block = atRule({ name: patch.name, params: patch.params ?? "" });
    block.raws.before = "\n\n";
    block.raws.between = " ";
    root.append(block);
  }
  for (const [property, value] of declarations) {
    let present = false;
    block.walkDecls(property, () => {
      present = true;
    });
    if (!present) block.append(decl({ prop: property, value }));
  }
}

/**
 * Adds a Tailwind v4 at-rule to CSS text without duplicating it. `@import` and
 * `@plugin` join the header group; any other rule is a block whose declarations
 * merge by property (a declaration already present is left untouched).
 */
export function addCssAtRule(css: string, patch: CssAtRulePatch): string {
  const root = parse(css);
  if (HEADER_RULES.includes(patch.name)) {
    let exists = false;
    root.walkAtRules(patch.name, (node) => {
      if (sameRule(node, patch)) exists = true;
    });
    if (exists) return css;
    insertHeaderRule(root, patch);
  } else {
    mergeBlockRule(root, patch);
  }
  return root.toString();
}
