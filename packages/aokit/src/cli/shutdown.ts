import { exitCodes } from "./exit-codes.ts";

type ShutdownHook = () => void | Promise<void>;

const registeredHooks = new Set<ShutdownHook>();

/** Registers cleanup to run on SIGINT/SIGTERM. Returns a function that unregisters it. */
export function registerShutdownHook(hook: ShutdownHook): () => void {
  registeredHooks.add(hook);
  return () => {
    registeredHooks.delete(hook);
  };
}

async function runHookSafely(hook: ShutdownHook): Promise<void> {
  try {
    await hook();
  } catch (hookError) {
    process.stderr.write(`shutdown hook failed: ${String(hookError)}\n`);
  }
}

async function runHooksInOrder(hooks: readonly ShutdownHook[]): Promise<void> {
  const [first, ...remaining] = hooks;
  if (first === undefined) {
    return;
  }
  await runHookSafely(first);
  await runHooksInOrder(remaining);
}

/** Runs every registered hook in registration order; one failing hook never blocks the rest. */
export async function runShutdownHooks(): Promise<void> {
  const hooks = [...registeredHooks];
  registeredHooks.clear();
  await runHooksInOrder(hooks);
}

interface SignalHandlerOptions {
  exit?: (code: number) => void;
}

/**
 * Makes SIGINT and SIGTERM run the shutdown hooks and exit `130`. A second
 * signal during cleanup exits immediately with `130`.
 */
export function installSignalHandlers(options: SignalHandlerOptions = {}): () => void {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let interrupted = false;
  const handleSignal = (): void => {
    if (interrupted) {
      exit(exitCodes.interrupted);
      return;
    }
    interrupted = true;
    void runShutdownHooks().finally(() => {
      exit(exitCodes.interrupted);
    });
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  return () => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  };
}
