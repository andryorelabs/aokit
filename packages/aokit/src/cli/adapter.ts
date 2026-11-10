import { createInterface } from "node:readline/promises";
import { createCli, t, type CommanderProgramLike } from "trpc-cli";
import { z } from "zod";
import { renderBanner } from "./banner.ts";
import { isColorEnabled } from "./color.ts";
import { runCommand, type AnyCommand, type CommandContext } from "./command.ts";
import { renderFailureReport, renderHuman } from "./human.ts";
import {
  exitCodeForEnvelope,
  failureEnvelope,
  internalStackOf,
  stringifySorted,
  successEnvelope,
  type Envelope,
} from "./envelope.ts";
import { exitCodes, type ExitCode } from "./exit-codes.ts";
import { aokitMeta } from "./meta.ts";
import { currentLockfileVersion } from "../lockfile/schema.ts";
import { registryProtocolVersion } from "../pipeline/assemble.ts";
import { isNonInteractive } from "../trust/gate.ts";
import { maybeNotifyUpdate, type UpdateFetch } from "./update-notice/index.ts";
import { spawnDetachedRefresh } from "./update-notice/spawn.ts";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  isTTY: boolean;
  /** Whether stderr is a terminal; {@link CliIo.isTTY} when absent. */
  isStderrTTY?: boolean;
}

export interface RunCliOptions {
  argv: readonly string[];
  commands: readonly AnyCommand[];
  hiddenCommands?: readonly AnyCommand[];
  env: Readonly<Record<string, string | undefined>>;
  version: string;
  io: CliIo;
  /** Whether prompts may be shown; the stdin TTY by default. */
  interactive?: boolean;
  /** Asks one question on the terminal; a readline prompt on stderr by default. */
  prompt?: (question: string) => Promise<string>;
  /** Clock for the update notice; `Date.now` by default. */
  now?: () => number;
  /** Fetch for the update check, run in this process; absent means a detached process does it. */
  fetch?: UpdateFetch;
  /** Whether the update notice may run; true by default. */
  updateNotice?: boolean;
}

async function askOnTerminal(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

interface GlobalFlags {
  json: boolean;
  noColor: boolean;
  verbose: boolean;
  version: boolean;
  rest: string[];
}

class ExitRequested extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`exit ${exitCode}`);
    this.exitCode = exitCode;
  }
}

function extractGlobalFlags(argv: readonly string[]): GlobalFlags {
  const flags: GlobalFlags = {
    json: false,
    noColor: false,
    verbose: false,
    version: false,
    rest: [],
  };
  let passthrough = false;
  for (const argument of argv) {
    if (passthrough) {
      flags.rest.push(argument);
    } else if (argument === "--") {
      passthrough = true;
      flags.rest.push(argument);
    } else if (argument === "--json") {
      flags.json = true;
    } else if (argument === "--no-color") {
      flags.noColor = true;
    } else if (argument === "--verbose") {
      flags.verbose = true;
    } else if (argument === "--version" || argument === "-V") {
      flags.version = true;
    } else {
      flags.rest.push(argument);
    }
  }
  return flags;
}

/**
 * Re-applies the aokit meta (`positional`, `alias`) as the keys trpc-cli
 * understands, so commands never mention trpc-cli themselves.
 */
function toParserSchema(input: z.ZodType): z.ZodType {
  if (!(input instanceof z.ZodObject)) {
    return input;
  }
  const fields: [string, z.ZodType][] = Object.entries<z.ZodType>(input.shape);
  const positionalFirst = fields.toSorted(([, left], [, right]) => {
    const leftPosition = aokitMeta.get(left)?.positional ?? Number.POSITIVE_INFINITY;
    const rightPosition = aokitMeta.get(right)?.positional ?? Number.POSITIVE_INFINITY;
    return leftPosition === rightPosition ? 0 : leftPosition < rightPosition ? -1 : 1;
  });
  const parserShape = Object.fromEntries(
    positionalFirst.map(([key, field]) => {
      const meta = aokitMeta.get(field);
      if (meta === undefined) {
        return [key, field];
      }
      return [
        key,
        field.meta({
          ...(meta.positional === undefined ? {} : { positional: true }),
          ...(meta.alias === undefined ? {} : { alias: meta.alias }),
          ...(meta.hidden === undefined ? {} : { hidden: meta.hidden }),
        }),
      ];
    }),
  );
  return z.object(parserShape);
}

function captureCommanderFailures(
  program: CommanderProgramLike,
  sink: (text: string) => void,
  requestExit: (exitCode: number) => never,
): void {
  const commanderProgram = program as CommanderProgramLike & {
    configureOutput?: (configuration: {
      writeOut: (text: string) => void;
      writeErr: (text: string) => void;
    }) => void;
    exitOverride?: (handler: (failure: { exitCode: number }) => never) => void;
  };
  commanderProgram.configureOutput?.({ writeOut: sink, writeErr: sink });
  commanderProgram.exitOverride?.((failure) => requestExit(failure.exitCode));
  for (const subcommand of program.commands ?? []) {
    captureCommanderFailures(subcommand, sink, requestExit);
  }
}

function usageFailure(rawMessage: string): Envelope {
  const message = (rawMessage.split("\n").find((line) => line.trim() !== "") ?? "")
    .replace(/^error:\s*/i, "")
    .trim();
  const code = /unknown (option|flag)/i.test(message)
    ? "UNKNOWN_FLAG"
    : /unknown command/i.test(message)
      ? "UNKNOWN_COMMAND"
      : "INVALID_INPUT";
  return failureEnvelope({
    code,
    message: message === "" ? "invalid command line" : message,
    fix: "run `aokit --help` to see the accepted commands and flags",
  });
}

interface ProcedureTree {
  [segment: string]: unknown;
}

const branches = new WeakSet<object>();

function isProcedureTree(value: unknown): value is ProcedureTree {
  return typeof value === "object" && value !== null && branches.has(value);
}

/**
 * Mounts a procedure at its command path: a name with a space (`mcp init`) becomes a nested
 * subcommand, so the first word is a router and the rest are its procedures.
 */
function mountProcedure(tree: ProcedureTree, path: readonly string[], procedure: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  const existing = tree[head];
  if (rest.length === 0) {
    if (isProcedureTree(existing)) {
      throw new Error(`command "${head}" collides with the nested commands under "${head}"`);
    }
    tree[head] = procedure;
    return;
  }
  if (existing !== undefined && !isProcedureTree(existing)) {
    throw new Error(`nested command under "${head}" collides with the command "${head}"`);
  }
  const branch: ProcedureTree = isProcedureTree(existing) ? existing : {};
  branches.add(branch);
  tree[head] = branch;
  mountProcedure(branch, rest, procedure);
}

function isHiddenTarget(command: AnyCommand, argv: readonly string[]): boolean {
  const words = command.name.split(" ");
  return words.every((word, index) => argv[index] === word);
}

async function dispatchThroughParser(
  options: RunCliOptions,
  context: CommandContext,
  rest: string[],
): Promise<Envelope> {
  let captured: Envelope | undefined;
  const parserMessages: string[] = [];
  const procedures: ProcedureTree = {};
  for (const command of options.commands) {
    mountProcedure(
      procedures,
      command.name.split(" "),
      t.procedure
        .input(toParserSchema(command.input))
        .meta({ description: command.description })
        .handler(async ({ input }) => {
          captured = await runCommand(command, context, input);
          return undefined;
        }),
    );
  }
  const cli = createCli({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every leaf is a procedure built above
    router: t.router(procedures as Parameters<typeof t.router>[0]),
    name: "aokit",
    version: options.version,
  });
  const collect = (...parts: unknown[]): void => {
    parserMessages.push(parts.map(String).join(" "));
  };
  const collectLog = (...parts: unknown[]): void => {
    if (parts.some((part) => /^ExitRequested\b/.test(String(part)))) return;
    collect(...parts);
  };
  const program = cli.buildProgram();
  let requestedExitCode: number | undefined;
  const requestExit = (exitCode: number): never => {
    requestedExitCode ??= exitCode;
    throw new ExitRequested(exitCode);
  };
  captureCommanderFailures(program, collect, requestExit);
  try {
    await cli.run(
      {
        argv: rest,
        prompts: false,
        logger: { info: collect, error: collectLog },
        process: {
          exit: requestExit,
        },
      },
      program,
    );
  } catch (thrown) {
    if (!(thrown instanceof ExitRequested)) {
      throw thrown;
    }
  }
  if (captured !== undefined) {
    return captured;
  }
  if (requestedExitCode === 0 || requestedExitCode === undefined) {
    return successEnvelope(parserMessages.join("\n").trimEnd());
  }
  return usageFailure(parserMessages.join("\n"));
}

function renderEnvelope(envelope: Envelope, json: boolean, color: boolean, io: CliIo): void {
  if (json) {
    io.stdout(`${stringifySorted(envelope)}\n`);
    return;
  }
  if (envelope.ok) {
    io.stdout(`${renderHuman(envelope.data)}\n`);
    return;
  }
  const report = renderFailureReport(envelope.data);
  if (report !== "") {
    io.stdout(`${report}\n`);
  }
  const label = color ? "\u001B[31merror\u001B[0m" : "error";
  io.stderr(`${label}: ${envelope.error.message}\n  fix:  ${envelope.error.fix}\n`);
}

function printInternalStack(envelope: Envelope, verbose: boolean, io: CliIo): void {
  if (!verbose || envelope.ok) {
    return;
  }
  const stack = internalStackOf(envelope.error);
  if (stack !== undefined) {
    io.stderr(`${stack}\n`);
  }
}

function shouldPrintBanner(flags: GlobalFlags, io: CliIo): boolean {
  if (flags.json || !io.isTTY) {
    return false;
  }
  const [only, ...others] = flags.rest;
  return only === undefined || (others.length === 0 && (only === "--help" || only === "-h"));
}

function notifyAboutUpdate(
  options: RunCliOptions,
  flags: GlobalFlags,
  context: CommandContext,
): void {
  if (options.updateNotice === false) {
    return;
  }
  const stderrIsTTY = options.io.isStderrTTY ?? options.io.isTTY;
  const yes = flags.rest.some((argument) => argument === "--yes" || argument === "-y");
  maybeNotifyUpdate({
    version: options.version,
    env: options.env,
    isTTY: stderrIsTTY,
    json: flags.json,
    quiet: flags.rest.some((argument) => argument === "--quiet" || argument === "-q"),
    interactive:
      context.interactive === true && !isNonInteractive({ yes, env: options.env, isTTY: true }),
    now: options.now ?? Date.now,
    fetch: options.fetch ?? fetch,
    ...(options.fetch === undefined ? { refresh: spawnDetachedRefresh } : {}),
    stderr: (text) => options.io.stderr(text),
  });
}

/**
 * Runs the CLI for one argv: binds the commands to trpc-cli, prints the
 * result and returns the exit code. It never calls `process.exit`.
 */
export async function runCli(options: RunCliOptions): Promise<ExitCode> {
  const flags = extractGlobalFlags(options.argv);
  const color = isColorEnabled({
    env: options.env,
    isTTY: options.io.isTTY,
    noColorFlag: flags.noColor,
  });
  const context: CommandContext = {
    version: options.version,
    env: options.env,
    commands: options.commands,
    interactive: options.interactive ?? process.stdin.isTTY,
    prompt: options.prompt ?? askOnTerminal,
  };

  let envelope: Envelope;
  if (flags.version && flags.rest.length === 0) {
    if (flags.json) {
      envelope = {
        ok: true,
        data: {
          version: options.version,
          lockfileVersion: currentLockfileVersion,
          registryProtocolVersion,
        },
        error: null,
      };
    } else {
      options.io.stdout(`${options.version}\n`);
      notifyAboutUpdate(options, flags, context);
      return exitCodes.success;
    }
  } else {
    const parserArgv = flags.rest.length === 0 ? ["--help"] : flags.rest;
    const hidden = (options.hiddenCommands ?? [])
      .filter((command) => isHiddenTarget(command, parserArgv))
      .toSorted((left, right) => right.name.split(" ").length - left.name.split(" ").length)[0];
    const parserOptions = hidden === undefined ? options : { ...options, commands: [hidden] };
    envelope = await dispatchThroughParser(parserOptions, context, parserArgv);
  }

  if (shouldPrintBanner(flags, options.io)) {
    options.io.stdout(renderBanner({ color }));
  }
  renderEnvelope(envelope, flags.json, color, options.io);
  printInternalStack(envelope, flags.verbose, options.io);
  notifyAboutUpdate(options, flags, context);
  return exitCodeForEnvelope(envelope);
}
