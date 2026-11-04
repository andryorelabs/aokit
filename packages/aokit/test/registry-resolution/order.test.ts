import { expect, test } from "bun:test";
import { resolutionOrder } from "../../src/project/registry.ts";
import type { Registry, RegistrySource } from "../../src/registry/index.ts";

function fake(source: RegistrySource): Pick<Registry, "source"> {
  return { source };
}

const registries = new Map<string, Pick<Registry, "source">>([
  ["official", fake({ kind: "bundled", path: "/bundled" })],
  ["acme", fake({ kind: "url", url: "https://r.test" })],
  ["mine", fake({ kind: "local", path: "/work/registry" })],
  ["mods", fake({ kind: "github", owner: "acme", repo: "mods", ref: "a".repeat(40) })],
  ["other", fake({ kind: "local", path: "/work/other" })],
]);

test("Modules are looked up in local, then remote, then bundled Registries, in Lockfile order", () => {
  expect(resolutionOrder({ registries, flagged: undefined })).toEqual([
    "mine",
    "other",
    "acme",
    "mods",
    "official",
  ]);
});

test("the --registry Registry is looked up first", () => {
  expect(resolutionOrder({ registries, flagged: "mods" })).toEqual([
    "mods",
    "mine",
    "other",
    "acme",
    "official",
  ]);
});
