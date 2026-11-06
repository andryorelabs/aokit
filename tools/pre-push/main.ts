import { checkPushLine, gateExitCode, pushNeedsGates, runGates } from "./pre-push-check.ts";

const lines = (await Bun.stdin.text()).split("\n").filter((line) => line.trim() !== "");

for (const line of lines) {
  const verdict = checkPushLine(line);
  if (!verdict.ok) {
    process.stderr.write(`pre-push: ${verdict.reason}\n`);
    process.exit(1);
  }
}

if (pushNeedsGates(lines)) {
  const exitCode = runGates((command) => {
    const result = Bun.spawnSync([...command], { stdout: "inherit", stderr: "inherit" });
    return gateExitCode(result.exitCode);
  });
  process.exit(exitCode);
}
