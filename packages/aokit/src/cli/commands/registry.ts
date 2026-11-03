import type { AnyCommand } from "../command.ts";
import { schemaCommand } from "./schema.ts";

/** Every command the CLI exposes. */
export const exposedCommands: readonly AnyCommand[] = [schemaCommand];
