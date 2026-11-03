import { z } from "zod";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";

const stubInput = z.object({});
const stubOutput = z.record(z.string(), z.unknown());

/** A lifecycle command that is registered but not built yet; it only fails with a pointer. */
export function defineStubCommand(name: string, description: string) {
  return defineCommand({
    name,
    description,
    input: stubInput,
    output: stubOutput,
    run() {
      throw new AokitError(
        "INTERNAL",
        `\`${name}\` is not implemented yet`,
        "this command ships in a later Phase 4a ticket",
      );
    },
  });
}
