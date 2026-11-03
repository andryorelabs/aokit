import type { AnswerMap } from "./answers.ts";

interface ReproduceInput {
  readonly directory: string;
  readonly layout: string;
  readonly modules: readonly string[];
  readonly answers: AnswerMap;
  readonly registry: string | undefined;
  readonly install: boolean;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The exact non-interactive `aokit create` command that reproduces this selection. */
export function reproduceCommand(input: ReproduceInput): string {
  const answerFlags = Object.entries(input.answers)
    .toSorted(([left], [right]) => byCodepoint(left, right))
    .flatMap(([module, values]) =>
      Object.entries(values)
        .toSorted(([left], [right]) => byCodepoint(left, right))
        .map(([key, value]) => `--answer ${shellQuote(`${module}.${key}=${String(value)}`)}`),
    );
  const parts = [
    "aokit create",
    shellQuote(input.directory),
    `--layout ${input.layout}`,
    `--modules ${input.modules.toSorted(byCodepoint).join(",")}`,
    ...answerFlags,
    ...(input.registry === undefined ? [] : [`--registry ${shellQuote(input.registry)}`]),
    ...(input.install ? [] : ["--no-install"]),
    "--yes",
  ];
  return parts.join(" ");
}
