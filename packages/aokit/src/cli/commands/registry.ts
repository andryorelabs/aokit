import type { AnyCommand } from "../command.ts";
import { addCommand } from "./add.ts";
import { checkCommand } from "./check.ts";
import { createCommand } from "./create.ts";
import { diffCommand } from "./diff.ts";
import { doctorCommand } from "./doctor.ts";
import { ejectCommand } from "./eject.ts";
import { mcpInitCommand } from "./mcp-init.ts";
import { recopyCommand } from "./recopy.ts";
import { removeCommand } from "./remove.ts";
import { restoreCommand } from "./restore.ts";
import { schemaCommand } from "./schema.ts";
import { updateCommand } from "./update.ts";

/** Every command the CLI exposes in `--help` and `aokit schema`. */
export const exposedCommands: readonly AnyCommand[] = [
  createCommand,
  addCommand,
  doctorCommand,
  diffCommand,
  checkCommand,
  ejectCommand,
  removeCommand,
  recopyCommand,
  updateCommand,
  restoreCommand,
  schemaCommand,
  mcpInitCommand,
];

/** Commands registered for dispatch but kept out of `--help` and `aokit schema`. */
export const hiddenCommands: readonly AnyCommand[] = [];
