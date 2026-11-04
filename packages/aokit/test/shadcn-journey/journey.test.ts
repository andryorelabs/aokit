import { afterEach, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { exitCodeForEnvelope } from "../../src/cli/envelope.ts";
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

const modules = "oxc,vite-react,tailwind4";

for (const layout of ["single", "monorepo"] as const) {
  test(`create, add @fixture/button, doctor, an edit and remove leave a fresh ${layout} render`, async () => {
    const context = await isolatedContext();
    const served = await serveJourneyFixture();
    fixtures.push(served);
    const { fixture, cards } = served;
    const project = join(await temporaryDirectory(), "app");
    const create = { layout, modules, yes: true, install: false };
    const created = await runCommand(createCommand, context, { ...create, directory: project });
    expect(exitCodeForEnvelope(created)).toBe(0);

    const added = await runCommand(addCommand, context, {
      directory: project,
      modules: ["@fixture/button"],
      registry: fixture.url,
      trust: [fixture.url, cards.trustSource],
      yes: true,
      install: false,
      allowDirty: true,
    });
    expect(exitCodeForEnvelope(added)).toBe(0);
    const lockfile = await readLockfileJson(project);
    const adapted = Object.keys(lockfile["modules"]).filter((name) => name.startsWith("@"));
    expect(adapted).toHaveLength(3);
    const files = Object.keys(lockfile["files"]);
    expect(files.some((path) => path.endsWith("ui/button.tsx"))).toBe(true);
    expect(files.some((path) => path.endsWith("lib/utils.ts"))).toBe(true);
    expect(files.some((path) => path.endsWith("ui/card.tsx"))).toBe(true);

    const healthy = await runCommand(doctorCommand, context, { directory: project });
    expect(healthy).toMatchObject({ ok: true, data: { clean: true, problems: [] } });

    const edited = join(project, "package.json");
    const original = await readFile(edited, "utf8");
    await writeFile(edited, `${original} `, "utf8");
    const drifted = await runCommand(doctorCommand, context, { directory: project });
    expect(drifted).toMatchObject({ ok: false, error: { code: "DRIFT" } });
    await writeFile(edited, original, "utf8");

    const removed = await runCommand(removeCommand, context, {
      directory: project,
      module: "@fixture/button",
      yes: true,
      install: false,
      allowDirty: true,
    });
    expect(removed).toMatchObject({ ok: true });
    expect(
      removeCommand.output.parse(removed.ok ? removed.data : undefined).orphans.toSorted(),
    ).toEqual(adapted.filter((name) => name !== "@fixture/button").toSorted());

    const fresh = join(await temporaryDirectory(), "app");
    const recreated = await runCommand(createCommand, context, { ...create, directory: fresh });
    expect(exitCodeForEnvelope(recreated)).toBe(0);
    expect(await snapshotTree(project)).toEqual(await snapshotTree(fresh));
  });
}
