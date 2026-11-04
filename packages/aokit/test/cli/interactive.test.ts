import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { type CommandContext, runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { removeShadcnFixtures } from "../registry-shadcn/served-shadcn-registry.ts";
import { cleanUp, isolatedContext, temporaryDirectory } from "../registry-resolution/support.ts";
import { type JourneyFixture, serveJourneyFixture } from "../shadcn-journey/fixture.ts";

const fixtures: JourneyFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()));
  await removeShadcnFixtures();
  await cleanUp();
});

async function projectAndRegistry(
  context: CommandContext,
): Promise<{ project: string; url: string }> {
  const project = join(await temporaryDirectory(), "app");
  const created = await runCommand(createCommand, context, {
    directory: project,
    modules: "oxc,vite-react,tailwind4",
    yes: true,
    install: false,
  });
  expect(created).toMatchObject({ ok: true });
  const served = await serveJourneyFixture();
  fixtures.push(served);
  return { project, url: served.fixture.url };
}

function addInput(project: string, url: string): Record<string, unknown> {
  return {
    directory: project,
    modules: ["@fixture/button"],
    registry: url,
    install: false,
    allowDirty: true,
    trust: [],
  };
}

test("add with interactive false fails with the exact --trust form and opens no prompt", async () => {
  const context = await isolatedContext();
  const { project, url } = await projectAndRegistry(context);
  let asked = 0;
  const envelope = await runCommand(
    addCommand,
    {
      ...context,
      interactive: false,
      prompt: async () => {
        asked += 1;
        return "yes";
      },
    },
    addInput(project, url),
  );
  expect(envelope).toMatchObject({ ok: false, error: { code: "REGISTRY_UNTRUSTED" } });
  expect(envelope.ok ? "" : envelope.error.message).toContain("Rerun with `--trust ");
  expect(asked).toBe(0);
});

test("add with interactive true asks the injected prompt for trust", async () => {
  const context = await isolatedContext();
  const { project, url } = await projectAndRegistry(context);
  const questions: string[] = [];
  const envelope = await runCommand(
    addCommand,
    {
      ...context,
      interactive: true,
      prompt: async (question) => {
        questions.push(question);
        return "yes";
      },
    },
    addInput(project, url),
  );
  expect(envelope).toMatchObject({ ok: true });
  expect(questions.length).toBeGreaterThan(0);
  expect(questions[0]).toContain("Trust it?");
});
