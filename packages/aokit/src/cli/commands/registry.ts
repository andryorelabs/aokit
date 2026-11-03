import type { AnyCommand } from "../command.ts";
import { addCommand } from "./add.ts";
import { checkCommand } from "./check.ts";
import { createCommand } from "./create.ts";
import { diffCommand } from "./diff.ts";
import { doctorCommand } from "./doctor.ts";
import { ejectCommand } from "./eject.ts";
import { recopyCommand } from "./recopy.ts";
import { removeCommand } from "./remove.ts";
import { restoreCommand } from "./restore.ts";
import { schemaCommand } from "./schema.ts";

/** Every command the CLI exposes in `--help` and `aokit schema`. */
export const exposedCommands: readonly AnyCommand[] = [createCommand, schemaCommand];

/** Lifecycle stubs: registered for their tickets, kept out of `--help` and `aokit schema`. */
export const hiddenCommands: readonly AnyCommand[] = [
  doctorCommand,
  diffCommand,
  checkCommand,
  ejectCommand,
  restoreCommand,
  addCommand,
  removeCommand,
  recopyCommand,
];
