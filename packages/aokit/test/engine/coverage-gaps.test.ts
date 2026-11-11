import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModuleManifestInput } from "@aokit/module";
import {
  EngineError,
  type EngineContext,
  type EngineModule,
  type Formatter,
  type OpHandler,
  Vfs,
  buildPlan,
  createOpRegistry,
} from "../../src/engine/index.ts";
import { normalizeProjectPath } from "../../src/engine/vfs.ts";
import { fixtureManifest } from "../helpers/fixture-manifest.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function moduleOf(
  manifest: Partial<ModuleManifestInput> & { name: string },
  sources: Record<string, string | Uint8Array> = {},
): EngineModule {
  return {
    manifest: fixtureManifest(manifest),
    readFile: (from) => sources[from] ?? "",
  };
}

const handler: OpHandler = () => {};

const writer: OpHandler = ({ vfs, module }) => {
  vfs.write("marker.txt", module);
};

test("createOpRegistry rejects two handlers for one Op name", () => {
  let error: unknown;
  try {
    createOpRegistry({ addEnv: handler }, { addEnv: handler });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(EngineError);
  expect(error instanceof EngineError && error.code).toBe("engine.duplicate-op-handler");
});

test("normalizeProjectPath rejects a path that escapes the Project root", () => {
  expect(() => normalizeProjectPath("../outside.txt")).toThrow(/escapes the Project root/);
  expect(() => normalizeProjectPath("..")).toThrow(/escapes the Project root/);
  expect(() => normalizeProjectPath("/abs.txt")).toThrow(/Invalid file path/);
});

test("Vfs.fromDirectory keeps files that are not valid UTF-8 as bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aokit-vfs-"));
  try {
    const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
    await writeFile(join(directory, "blob.bin"), binary);
    await writeFile(join(directory, "note.txt"), "a\r\nb");
    const vfs = await Vfs.fromDirectory(directory);
    expect(vfs.read("blob.bin")).toEqual(binary);
    expect(vfs.read("note.txt")).toBe("a\nb");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a binary Module file is copied as bytes and a Formatter leaving it unchanged adds no Provenance", async () => {
  const bytes = new Uint8Array([1, 2, 3, 255]);
  const formatter: Formatter = {
    name: "noop-fmt",
    format(vfs) {
      const next = vfs.clone();
      next.write("blob.bin", new Uint8Array([1, 2, 3, 255]));
      next.write("extra.txt", "added by the formatter");
      return next;
    },
  };
  const plan = await buildPlan({
    modules: [
      moduleOf({ name: "m", files: [{ from: "b", to: "blob.bin", target: "root" }] }, { b: bytes }),
    ],
    layout: "single",
    answers: {},
    context,
    formatter,
  });
  expect(plan.vfs.read("blob.bin")).toEqual(bytes);
  const change = plan.changes.find((entry) => entry.path === "blob.bin");
  expect(change?.provenance.map((entry) => entry.module)).toEqual(["m"]);
});

test("a Formatter rewriting a binary file with different bytes records its Provenance", async () => {
  const formatter: Formatter = {
    name: "bin-fmt",
    format(vfs) {
      const next = vfs.clone();
      next.write("blob.bin", new Uint8Array([9, 9]));
      return next;
    },
  };
  const plan = await buildPlan({
    modules: [
      moduleOf(
        { name: "m", files: [{ from: "b", to: "blob.bin", target: "root" }] },
        { b: new Uint8Array([1, 2, 3]) },
      ),
    ],
    layout: "single",
    answers: {},
    context,
    formatter,
  });
  expect(plan.vfs.read("blob.bin")).toEqual(new Uint8Array([9, 9]));
  const change = plan.changes.find((entry) => entry.path === "blob.bin");
  expect(change?.provenance.map((entry) => entry.module)).toEqual(["m", "bin-fmt"]);
});

test("an overridden Op's writes are logged as overridden", async () => {
  const plan = await buildPlan({
    modules: [
      moduleOf({ name: "first", ops: [{ op: "addEnv", target: "root", entries: {} }] }),
      moduleOf({
        name: "second",
        ops: [{ op: "addEnv", target: "root", entries: {} }],
        override: [{ op: "addEnv", reason: "replace" }],
      }),
    ],
    layout: "single",
    answers: {},
    context,
    opHandlers: createOpRegistry({ addEnv: writer }),
  });
  const change = plan.changes.find((entry) => entry.path === "marker.txt");
  const first = change?.provenance.find((entry) => entry.module === "first");
  expect(first?.overridden).toBe(true);
  expect(change?.provenance.find((entry) => entry.module === "second")?.overridden).toBeUndefined();
});

test("a binary file with the same length as the base but different bytes is an update", async () => {
  const base = Vfs.empty();
  base.write("blob.bin", new Uint8Array([1, 2, 3]));
  base.write("same.bin", new Uint8Array([4, 5, 6]));
  const plan = await buildPlan({
    modules: [
      moduleOf(
        {
          name: "m",
          files: [
            { from: "changed", to: "blob.bin", target: "root" },
            { from: "same", to: "same.bin", target: "root" },
          ],
        },
        { changed: new Uint8Array([1, 2, 4]), same: new Uint8Array([4, 5, 6]) },
      ),
    ],
    layout: "single",
    answers: {},
    context,
    base,
  });
  expect(plan.changes.find((change) => change.path === "blob.bin")?.type).toBe("update");
  expect(plan.changes.find((change) => change.path === "same.bin")).toBeUndefined();
});
