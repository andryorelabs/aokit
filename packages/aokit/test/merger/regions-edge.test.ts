import { describe, expect, test } from "bun:test";
import { createMerger } from "../../src/merger/index.ts";

const block = (id: string, body: string) =>
  `<!-- aokit:begin ${id} -->\n${body}\n<!-- aokit:end ${id} -->`;
const file = (...parts: string[]) => `${parts.join("\n\n")}\n`;

const merger = createMerger();

function mergeAgents(base: string, user: string, next: string) {
  return merger.merge({ base, user, next, path: "AGENTS.md" });
}

describe("Region merger edge cases", () => {
  const header = block("aokit:header", "header");

  test("a Region the user edited stays when next drops it", async () => {
    const docker = block("docker:agents", "docker");
    const edited = block("docker:agents", "docker, edited by the user");
    const result = await mergeAgents(file(header, docker), file(header, edited), file(header));
    expect(result.content).toContain("<!-- aokit:begin docker:agents -->");
    expect(result.content).toContain("docker, edited by the user");
    expect(result.content).toContain("<!-- aokit:begin aokit:header -->");
  });

  test("a malformed base is treated as having no Regions", async () => {
    const base = "<!-- aokit:begin broken:r -->\nno end marker\n";
    const next = file(header);
    const result = await mergeAgents(base, file(header), next);
    expect(result.conflict).toBe(false);
    expect(result.content).toBe(next);
  });

  test("a user Region absent from a malformed base is kept when next drops it", async () => {
    const base = "<!-- aokit:begin broken:r -->\nno end marker\n";
    const user = file(header, block("gone:agents", "user body"));
    const result = await mergeAgents(base, user, file(header));
    expect(result.content).toContain("<!-- aokit:begin aokit:header -->");
  });
});
