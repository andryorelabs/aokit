import { expect, spyOn, test } from "bun:test";
import { installSignalHandlers, registerShutdownHook } from "../../src/cli/shutdown.ts";

test("a second signal during cleanup exits immediately with 130", async () => {
  const exits: number[] = [];
  const release = Promise.withResolvers<void>();
  const unregister = registerShutdownHook(() => release.promise);
  const uninstall = installSignalHandlers({ exit: (code) => exits.push(code) });
  try {
    process.emit("SIGINT");
    process.emit("SIGINT");
    expect(exits).toEqual([130]);
    release.resolve();
    await new Promise((resolveTurn) => setTimeout(resolveTurn, 10));
    expect(exits).toEqual([130, 130]);
  } finally {
    uninstall();
    unregister();
  }
});

test("a failing hook is reported on stderr and later hooks still run", async () => {
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation(() => true);
  const ran: string[] = [];
  const exited = Promise.withResolvers<number>();
  const unregisterFailing = registerShutdownHook(() => {
    throw new Error("hook failure");
  });
  const unregisterLater = registerShutdownHook(() => {
    ran.push("later");
  });
  const uninstall = installSignalHandlers({ exit: exited.resolve });
  try {
    process.emit("SIGTERM");
    expect(await exited.promise).toBe(130);
    expect(ran).toEqual(["later"]);
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("hook failure"));
  } finally {
    uninstall();
    unregisterFailing();
    unregisterLater();
    stderrWrite.mockRestore();
  }
});
