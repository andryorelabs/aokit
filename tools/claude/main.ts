import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { approvalOutput, isApprovedRm, readCommand } from "./rm-guard.ts";

const command = readCommand(await Bun.stdin.text());
const repoRoot = resolve(import.meta.dir, "..", "..");

if (command !== undefined && isApprovedRm(command, { repoRoot, tempDirectory: tmpdir() })) {
  process.stdout.write(`${approvalOutput}\n`);
}
