import { z } from "zod";
import { apply } from "../../apply/index.ts";
import { Vfs } from "../../engine/vfs.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import { toAokitError } from "../../project/errors.ts";
import { defineCommand } from "../command.ts";
import { aokitMeta } from "../meta.ts";
import { findLockedFile } from "./restore.ts";

const ejectInput = z.object({
  path: z
    .string()
    .describe("Project-relative path of the file to eject")
    .register(aokitMeta, { positional: 0, examples: ["src/main.tsx"] }),
  directory: z
    .string()
    .default(".")
    .describe("Project directory")
    .register(aokitMeta, { flag: "directory", examples: ["--directory ./my-app"] }),
});

const ejectOutput = z.object({
  directory: z.string(),
  path: z.string(),
  mode: z.literal("ejected"),
  previousMode: z.enum(["managed", "seed", "ejected"]),
});

export const ejectCommand = defineCommand({
  name: "eject",
  description: "Eject a file from aokit management",
  input: ejectInput,
  output: ejectOutput,
  async run(_context, input) {
    const locked = await findLockedFile(input.directory, input.path);
    const lockfile: Lockfile = {
      ...locked.lockfile,
      files: { ...locked.lockfile.files, [locked.path]: { ...locked.entry, mode: "ejected" } },
    };
    try {
      await apply({ changes: [], hash: "", vfs: Vfs.empty() }, lockfile, locked.directory);
    } catch (thrown) {
      throw toAokitError(thrown);
    }
    return {
      directory: locked.directory,
      path: locked.path,
      mode: "ejected" as const,
      previousMode: locked.entry.mode,
    };
  },
});
