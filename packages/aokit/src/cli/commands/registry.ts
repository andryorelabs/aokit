import type { AnyCommand } from "../command.ts";
import { createCommand } from "./create.ts";
import { schemaCommand } from "./schema.ts";

/** Every command the CLI exposes. */
export const exposedCommands: readonly AnyCommand[] = [createCommand, schemaCommand];
