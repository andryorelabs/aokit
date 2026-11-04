import {
  atRule,
  decl,
  parse,
  rule as cssRule,
  type AtRule,
  type Container,
  type Declaration,
  type Root,
} from "postcss";

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

/** The stylesheet group a custom property belongs to. */
type CssVariableGroup = "theme" | "light" | "dark";

/** Custom properties to set in one group; `overwrite` replaces values that already exist. */
export interface CssVariablesPatch {
  readonly group: CssVariableGroup;
  readonly variables: Readonly<Record<string, string>>;
  readonly overwrite?: boolean;
}

function findGroupBlock(root: Root, group: CssVariableGroup): Container | undefined {
  let found: Container | undefined;
  for (const node of root.nodes) {
    if (found) break;
    if (
      group === "theme" &&
      node.type === "atrule" &&
      node.name === "theme" &&
      node.params === ""
    ) {
      found = node;
    } else if (node.type === "rule" && node.selector === (group === "light" ? ":root" : ".dark")) {
      found = node;
    }
  }
  return found;
}

function createGroupBlock(root: Root, group: CssVariableGroup): Container {
  const block =
    group === "theme"
      ? atRule({ name: "theme", params: "" })
      : cssRule({ selector: group === "light" ? ":root" : ".dark" });
  block.raws.before = root.nodes.length === 0 ? "" : "\n\n";
  block.raws.between = " ";
  root.append(block);
  return block;
}

function propertyName(name: string): string {
  return name.startsWith("--") ? name : `--${name}`;
}

/**
 * Sets custom properties in the `theme` (`@theme`), `light` (`:root`) or `dark` (`.dark`) group of
 * CSS text. A variable already present keeps its value unless `overwrite` is set; a second run
 * with the same patch returns the text unchanged.
 */
export function addCssVariables(css: string, patch: CssVariablesPatch): string {
  const root = parse(css);
  const entries = Object.entries(patch.variables);
  const block = findGroupBlock(root, patch.group);
  const target = block ?? (entries.length > 0 ? createGroupBlock(root, patch.group) : undefined);
  if (!target) return css;
  for (const [name, value] of entries) {
    const prop = propertyName(name);
    const existing: Declaration[] = [];
    target.each((child) => {
      if (child.type === "decl" && child.prop === prop) existing.push(child);
    });
    if (existing.length === 0) {
      target.append(decl({ prop, value }));
    } else if (patch.overwrite) {
      for (const declaration of existing) declaration.value = value;
    }
  }
  return root.toString();
}
