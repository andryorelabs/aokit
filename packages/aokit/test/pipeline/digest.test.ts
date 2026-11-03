import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { buildProject } from "../../src/pipeline/index.ts";
import { input } from "./fixtures.ts";

async function digestLines(): Promise<string[]> {
  const lines: string[] = [];
  for (const layout of ["single", "monorepo"] as const) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- fixed, ordered output
    const built = await buildProject(input({ layout, selection: ["auth"] }));
    if (!built.ok) {
      throw new Error(built.error.message);
    }
    const lockfileDigest = createHash("sha256").update(built.lockfileText).digest("hex");
    lines.push(`${layout} plan=${built.plan.hash} lockfile=${lockfileDigest}`);
  }
  return lines;
}

test("prints the determinism digest and writes it to AOKIT_DIGEST_FILE when set", async () => {
  const lines = await digestLines();
  expect(await digestLines()).toEqual(lines);
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(`determinism digest\n${text}`);
  const target = process.env["AOKIT_DIGEST_FILE"];
  if (target !== undefined && target !== "") {
    await writeFile(target, text);
  }
});
