import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type CommandContext, runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { removeShadcnFixtures } from "../registry-shadcn/served-shadcn-registry.ts";
import {
  cleanUp,
  isolatedContext,
  readLockfileJson,
  snapshotTree,
  temporaryDirectory,
} from "../registry-resolution/support.ts";
import { type JourneyFixture, serveJourneyFixture } from "./fixture.ts";

const fixtures: JourneyFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
  await removeShadcnFixtures();
  await cleanUp();
});

const lifecycle = { yes: true, install: false, allowDirty: true };

async function served(): Promise<JourneyFixture> {
  const fixture = await serveJourneyFixture();
  fixtures.push(fixture);
  return fixture;
}

async function createStyledProject(
  context: CommandContext,
  layout: "single" | "monorepo" = "single",
): Promise<string> {
  const directory = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory,
    layout,
    modules: "oxc,vite-react,tailwind4",
    yes: true,
    install: false,
    git: false,
  });
  await rm(join(directory, "README.md"), { force: true });
  expect(created).toMatchObject({ ok: true });
  return directory;
}

test("add @fixture/button installs it, @fixture/utils and the URL item, each Registry trusted on its own", async () => {
  const context = await isolatedContext();
  const project = await createStyledProject(context);
  const { fixture, cards } = await served();
  const added = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: ["@fixture/button"],
    registry: fixture.url,
    trust: [fixture.url, cards.trustSource],
  });
  expect(added).toMatchObject({ ok: true, data: { added: ["@fixture/button"] } });
  const lockfile = await readLockfileJson(project);
  const cardModule = Object.keys(lockfile["modules"]).find((name) => name.endsWith("/card"));
  expect(cardModule).toBeDefined();
  expect(lockfile["modules"]["@fixture/button"]).toMatchObject({
    registry: "fixture",
    selected: true,
  });
  expect(lockfile["modules"]["@fixture/utils"]).toMatchObject({
    registry: "fixture",
    selected: false,
  });
  const cardKey: string = lockfile["modules"][cardModule ?? ""]?.["registry"] ?? "";
  expect(lockfile["modules"][cardModule ?? ""]?.["selected"]).toBe(false);
  expect(lockfile["registries"]["fixture"]).toMatchObject({
    source: `${fixture.url}/registry.json`,
    trusted: true,
  });
  expect(lockfile["registries"][cardKey]).toMatchObject({
    source: `${cards.trustSource}/registry.json`,
    trusted: true,
  });
  expect(lockfile["modules"]["@fixture/button"]?.["version"]).toMatch(
    /^0\.0\.0-shadcn\.[0-9a-f]{12}$/,
  );
  const data = addCommand.output.parse(added.ok ? added.data : undefined);
  const fetched = data.fetched.map((entry) => entry.module);
  expect(fetched).toEqual(["@fixture/button", "@fixture/utils", cardModule ?? ""].toSorted());
  expect(data.pulledIn.toSorted()).toEqual(["@fixture/utils", cardModule ?? ""].toSorted());
});

test("the URL item's Registry asks for its own trust", async () => {
  const context = await isolatedContext();
  const project = await createStyledProject(context);
  const { fixture, cards } = await served();
  const before = await snapshotTree(project);
  const added = await runCommand(addCommand, context, {
    ...lifecycle,
    directory: project,
    modules: ["@fixture/button"],
    registry: fixture.url,
    trust: [fixture.url],
  });
  expect(added).toMatchObject({ ok: false, error: { code: "REGISTRY_UNTRUSTED" } });
  expect(JSON.stringify(added)).toContain(cards.trustSource);
  expect(await snapshotTree(project)).toEqual(before);
});
