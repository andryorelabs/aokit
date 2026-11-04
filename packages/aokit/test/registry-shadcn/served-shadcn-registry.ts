import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ServedRegistry, serveRegistry } from "../registry-remote/served-registry.ts";

/** One item of the fixture shadcn Registry, as its `<name>.json` serves it. */
export type FixtureItem = Readonly<Record<string, unknown>> & { readonly name: string };

/** The items the fixture shadcn Registry `fixture` serves; written for these tests only. */
export function fixtureItems(): FixtureItem[] {
  return [
    {
      name: "button",
      type: "registry:ui",
      dependencies: ["clsx@^2.1.0"],
      files: [
        {
          path: "ui/button.tsx",
          type: "registry:ui",
          content:
            'import { cn } from "@lib/utils";\n\nexport function Button() {\n  return <button className={cn("fixture-button")} />;\n}\n',
        },
      ],
    },
    {
      name: "use-toggle",
      type: "registry:hook",
      files: [
        {
          path: "hooks/use-toggle.ts",
          type: "registry:hook",
          content: "export function useToggle(): boolean {\n  return false;\n}\n",
        },
      ],
    },
    {
      name: "mono",
      type: "registry:font",
      files: [],
    },
  ];
}

/** A shadcn Registry directory served over HTTP, whose items can be rewritten in place. */
export interface ServedShadcnRegistry extends ServedRegistry {
  readonly root: string;
  /** Writes (or rewrites) one item's JSON, as an upstream change does. */
  writeItem(item: FixtureItem): Promise<void>;
}

const roots: string[] = [];

/** Removes every directory {@link serveShadcnRegistry} created. */
export async function removeShadcnFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

/**
 * Writes `registry.json` (named `name`, listing every item) and one `<item>.json` per item into a
 * fresh directory and serves it with `Bun.serve` on 127.0.0.1.
 */
export async function serveShadcnRegistry(
  items: readonly FixtureItem[] = fixtureItems(),
  name: string | undefined = "fixture",
): Promise<ServedShadcnRegistry> {
  const root = await mkdtemp(join(tmpdir(), "aokit-shadcn-fixture-"));
  roots.push(root);
  const writeItem = (item: FixtureItem): Promise<void> =>
    writeFile(join(root, `${item.name}.json`), `${JSON.stringify(item, null, 2)}\n`, "utf8");
  await writeFile(
    join(root, "registry.json"),
    `${JSON.stringify(
      {
        ...(name === undefined ? {} : { name }),
        homepage: "https://fixture.invalid",
        items: items.map((item) => ({ name: item.name, type: item.type })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await Promise.all(items.map(writeItem));
  return { ...serveRegistry(root), root, writeItem };
}
