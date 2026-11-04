import type { CallToolResult } from "@modelcontextprotocol/server";
import { stringifySorted, type Envelope } from "../cli/envelope.ts";

/**
 * Maps a command envelope to a tool result: the envelope is the structured content and its JSON
 * the text content, and a failed envelope is a tool error, never a protocol error.
 */
export function toToolResult(envelope: Envelope): CallToolResult {
  return {
    content: [{ type: "text", text: stringifySorted(envelope) }],
    structuredContent: { ...envelope },
    isError: !envelope.ok,
  };
}
