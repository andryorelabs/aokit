import { checkPushLine } from "./pre-push-check.ts";

const lines = (await Bun.stdin.text()).split("\n").filter((line) => line.trim() !== "");

for (const line of lines) {
  const verdict = checkPushLine(line);
  if (!verdict.ok) {
    process.stderr.write(`pre-push: ${verdict.reason}\n`);
    process.exit(1);
  }
}
