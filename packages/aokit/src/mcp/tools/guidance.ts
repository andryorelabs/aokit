import { z } from "zod";
import { successEnvelope, type Envelope } from "../../cli/envelope.ts";
import { guidanceTopics, renderGuidance } from "../guidance/index.ts";
import type { McpToolDefinition } from "./index.ts";
import { openDefaultRegistry } from "./schema.ts";

const guidanceToolInput = z.object({
  topic: z.enum(guidanceTopics).describe("The guidance topic to read"),
});

export const getGuidanceTool: McpToolDefinition = {
  name: "get_guidance",
  description:
    "Read how to use aokit: the vocabulary (`overview`), the tool order (`workflow`), the available Modules (`modules`) and Layouts (`layouts`), and every error code (`errors`).",
  input: guidanceToolInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  async run(_session, input, context): Promise<Envelope> {
    const { topic } = guidanceToolInput.parse(input);
    const registry = await openDefaultRegistry(context);
    return successEnvelope({ topic, markdown: renderGuidance(topic, registry) });
  },
};
