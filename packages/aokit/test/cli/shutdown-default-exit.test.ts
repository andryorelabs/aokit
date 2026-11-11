import { expect, spyOn, test } from "bun:test";
import { installSignalHandlers } from "../../src/cli/shutdown.ts";

test("without an exit option the default exits the process with 130", async () => {
  const exited = Promise.withResolvers<number>();
  const exit = spyOn(process, "exit").mockImplementation((code) => {
    exited.resolve(Number(code ?? 0));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a mocked exit must return so the test keeps running
    return undefined as never;
  });
  const uninstall = installSignalHandlers();
  try {
    process.emit("SIGINT");
    expect(await exited.promise).toBe(130);
  } finally {
    uninstall();
    exit.mockRestore();
  }
});
