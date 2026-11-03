import { createCli, t, type CommanderProgramLike } from "trpc-cli";
import { z } from "zod";
import { isColorEnabled } from "./color.ts";
import { runCommand, type AnyCommand, type CommandContext } from "./command.ts";
import { renderFailureReport, renderHuman } from "./human.ts";
import {
  exitCodeForEnvelope,
  failureEnvelope,
  stringifySorted,
  successEnvelope,
  type Envelope,
} from "./envelope.ts";
import { exitCodes, type ExitCode } from "./exit-codes.ts";
import { aokitMeta } from "./meta.ts";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  isTTY: boolean;
}

export interface RunCliOptions {
  argv: readonly string[];
  commands: readonly AnyCommand[];
  hiddenCommands?: readonly AnyCommand[];
  env: Readonly<Record<string, string | undefined>>;
  version: string;
  io: CliIo;
}

interface GlobalFlags {
  json: boolean;
  noColor: boolean;
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
  const flags: GlobalFlags = { json: false, noColor: false, version: false, rest: [] };
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
  const fields = Object.entries(input.shape);
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

async function dispatchThroughParser(
  options: RunCliOptions,
  context: CommandContext,
  rest: string[],
): Promise<Envelope> {
  let captured: Envelope | undefined;
  const parserMessages: string[] = [];
  const procedures = Object.fromEntries(
    options.commands.map((command) => [
      command.name,
      t.procedure
        .input(toParserSchema(command.input))
        .meta({ description: command.description })
        .handler(async ({ input }) => {
          captured = await runCommand(command, context, input);
          return undefined;
        }),
    ]),
  );
  const cli = createCli({
    router: t.router(procedures),
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
  };

  let envelope: Envelope;
  if (flags.version && flags.rest.length === 0) {
    if (flags.json) {
      envelope = { ok: true, data: { version: options.version }, error: null };
    } else {
      options.io.stdout(`${options.version}\n`);
      return exitCodes.success;
    }
  } else {
    const parserArgv = flags.rest.length === 0 ? ["--help"] : flags.rest;
    const hidden = (options.hiddenCommands ?? []).find((command) => command.name === parserArgv[0]);
    const parserOptions = hidden === undefined ? options : { ...options, commands: [hidden] };
    envelope = await dispatchThroughParser(parserOptions, context, parserArgv);
  }

  renderEnvelope(envelope, flags.json, color, options.io);
  return exitCodeForEnvelope(envelope);
}
