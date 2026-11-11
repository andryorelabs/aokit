import { afterEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { cleanTemporaryDirectories, commandContext, temporaryDirectory } from "../diff/support.ts";

afterEach(cleanTemporaryDirectories);

const overridingModule = `export default {
  name: "overlay",
  version: "1.0.0",
  description: "Fixture Module that overrides a file nothing produces.",
  provides: ["overlay"],
  override: [{ file: "ghost.txt", reason: "exercise the inert override warning" }],
};
`;

test("a Resolver warning is returned in the create result", async () => {
  const source = await writeRegistrySourceFixture();
  await mkdir(join(source, "overlay"), { recursive: true });
  await writeFile(join(source, "overlay/module.ts"), overridingModule, "utf8");
  const registry = await temporaryDirectory();
  await buildRegistry(source, registry);
  const directory = join(await temporaryDirectory(), "app");
  const envelope = await runCommand(createCommand, commandContext, {
    directory,
    modules: "overlay",
    registry,
    yes: true,
    install: false,
    git: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  const { warnings } = createCommand.output.parse(envelope.data);
  expect(warnings).toEqual([
    'module "overlay" overrides "ghost.txt" but no other selected module produces it, so the override has no effect.',
  ]);
});
