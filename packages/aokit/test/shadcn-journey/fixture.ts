import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ServedRegistry, serveRegistry } from "../registry-remote/served-registry.ts";
import {
  type FixtureItem,
  type ServedShadcnRegistry,
  serveShadcnRegistry,
} from "../registry-shadcn/served-shadcn-registry.ts";
import { temporaryDirectory } from "../registry-resolution/support.ts";

/** The `card` item another host serves at `/r/card.json`, with no `registry.json` beside it. */
export function cardItem(): FixtureItem {
  return {
    name: "card",
    type: "registry:ui",
    files: [
      {
        path: "ui/card.tsx",
        type: "registry:ui",
        content: "export function Card() {\n  return <div />;\n}\n",
      },
    ],
  };
}

/** The `fixture` items: `button` (type `ui`, with `cssVars`) needs `utils` and the card URL. */
export function journeyItems(cardUrl: string): FixtureItem[] {
  return [
    {
      name: "button",
      type: "registry:ui",
      dependencies: ["clsx@^2.1.0"],
      registryDependencies: ["@fixture/utils", cardUrl],
      cssVars: { light: { "--fixture-primary": "oklch(0.2 0 0)" } },
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
      name: "utils",
      type: "registry:lib",
      files: [
        {
          path: "lib/utils.ts",
          type: "registry:lib",
          content:
            "export function cn(...names: string[]): string {\n  return names.join(' ');\n}\n",
        },
      ],
    },
  ];
}

/** A host serving single items under `/r/` and no `registry.json`. */
export interface ServedItemHost extends ServedRegistry {
  /** The URL of an item's JSON file. */
  itemUrl(name: string): string;
  /** The directory URL `--trust` names to trust the host's items. */
  readonly trustSource: string;
}

/** Serves `items` as `/r/<name>.json` from a fresh directory on 127.0.0.1. */
export async function serveItemHost(items: readonly FixtureItem[]): Promise<ServedItemHost> {
  const root = await temporaryDirectory("aokit-shadcn-items-");
  await mkdir(join(root, "r"), { recursive: true });
  await Promise.all(
    items.map((item) =>
      writeFile(join(root, "r", `${item.name}.json`), `${JSON.stringify(item, null, 2)}\n`),
    ),
  );
  const server = serveRegistry(root);
  return {
    ...server,
    itemUrl: (name) => `${server.url}/r/${name}.json`,
    trustSource: `${server.url}/r`,
  };
}

/** The served `fixture` Registry and card host of the journey; stop both when done. */
export interface JourneyFixture {
  readonly fixture: ServedShadcnRegistry;
  readonly cards: ServedItemHost;
  stop(): Promise<void>;
}

/** Serves the card host, then the `fixture` Registry whose button depends on its card. */
export async function serveJourneyFixture(
  items?: (cardUrl: string) => FixtureItem[],
): Promise<JourneyFixture> {
  const cards = await serveItemHost([cardItem()]);
  const fixture = await serveShadcnRegistry((items ?? journeyItems)(cards.itemUrl("card")));
  return {
    fixture,
    cards,
    stop: async () => {
      await Promise.all([fixture.stop(), cards.stop()]);
    },
  };
}
