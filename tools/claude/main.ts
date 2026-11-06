import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { approvalOutput, isApprovedRm, readCommand, readWorkingDirectory } from "./rm-guard.ts";

const rawPayload = await Bun.stdin.text();
const command = readCommand(rawPayload);
const repoRoot = resolve(import.meta.dir, "..", "..");
const workingDirectory = readWorkingDirectory(rawPayload) ?? repoRoot;

if (
  command !== undefined &&
  isApprovedRm(command, { repoRoot, tempDirectory: tmpdir(), workingDirectory })
) {
  process.stdout.write(`${approvalOutput}\n`);
}
