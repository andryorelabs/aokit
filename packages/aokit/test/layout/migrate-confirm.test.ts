import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runCommand, type CommandContext } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { layoutMigrateCommand } from "../../src/cli/commands/layout-migrate.ts";
import { commitAll, context, newWorkspace } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

let counter = 0;

async function singleProject(): Promise<string> {
  counter += 1;
  const directory = join(workspace, `app-${counter}`);
  const envelope = await runCommand(createCommand, context, {
    directory,
    layout: "single",
    modules: "oxc",
    yes: true,
    install: false,
    git: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  await commitAll(directory);
  return directory;
}

function interactiveContext(answer: string, questions: string[]): CommandContext {
  return {
    ...context,
    interactive: true,
    prompt: (question) => {
      questions.push(question);
      return Promise.resolve(answer);
    },
  };
}

describe("layout migrate confirmation", () => {
  test("asks on the terminal and applies after a yes", async () => {
    const directory = await singleProject();
    const questions: string[] = [];
    const envelope = await runCommand(layoutMigrateCommand, interactiveContext("y", questions), {
      directory,
      layout: "monorepo",
      yes: false,
    });
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain("Apply this migration? [y/N]");
    expect(envelope.ok).toBe(true);
    expect(envelope.ok && envelope.data).toMatchObject({ applied: true, layout: "monorepo" });
  });

  test("does not apply after a no", async () => {
    const directory = await singleProject();
    const envelope = await runCommand(layoutMigrateCommand, interactiveContext("n", []), {
      directory,
      layout: "monorepo",
      yes: false,
    });
    expect(envelope.ok).toBe(false);
  });

  test("fails with MISSING_VALUE when there is no terminal and no --yes", async () => {
    const directory = await singleProject();
    const envelope = await runCommand(layoutMigrateCommand, context, {
      directory,
      layout: "monorepo",
      yes: false,
    });
    expect(envelope.ok).toBe(false);
    expect(!envelope.ok && envelope.error.code).toBe("MISSING_VALUE");
  });

  test("requires a target Layout", async () => {
    const directory = await singleProject();
    const envelope = await runCommand(layoutMigrateCommand, context, { directory, yes: true });
    expect(!envelope.ok && envelope.error.code).toBe("INVALID_INPUT");
  });

  test("--abort reports nothing to abort when no migration is in progress", async () => {
    const directory = await singleProject();
    const envelope = await runCommand(layoutMigrateCommand, context, {
      directory,
      abort: true,
      yes: true,
    });
    expect(envelope.ok && envelope.data).toMatchObject({
      aborted: false,
      message: "Nothing to abort.",
    });
  });
});
