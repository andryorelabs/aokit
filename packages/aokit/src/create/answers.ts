import type { ModuleManifest } from "@aokit/module";
import { AokitError } from "../cli/envelope.ts";
import type { AnswerValue } from "../engine/interpolate.ts";

/** Answers keyed by Module name, then answer key. */
export type AnswerMap = Record<string, Record<string, AnswerValue>>;

interface RawAnswer {
  readonly module: string;
  readonly key: string;
  readonly raw: string;
}

type DeclaredAnswer = NonNullable<ModuleManifest["answers"]>[string];

const answerFix =
  "pass answers as `--answer <module.key=value>`, for example `--answer next.appRouter=true`";

function parseRawAnswer(flag: string): RawAnswer {
  const equals = flag.indexOf("=");
  const left = equals === -1 ? "" : flag.slice(0, equals);
  const dot = left.indexOf(".");
  const module = dot === -1 ? "" : left.slice(0, dot);
  const key = dot === -1 ? "" : left.slice(dot + 1);
  if (module === "" || key === "") {
    throw new AokitError(
      "INVALID_INPUT",
      `malformed --answer \`${flag}\`: expected <module.key=value>`,
      answerFix,
    );
  }
  return { module, key, raw: flag.slice(equals + 1) };
}

function coerce(entry: RawAnswer, declared: DeclaredAnswer): AnswerValue {
  const label = `${entry.module}.${entry.key}`;
  if (declared.type === "boolean") {
    if (entry.raw !== "true" && entry.raw !== "false") {
      throw new AokitError(
        "INVALID_INPUT",
        `--answer ${label} must be true or false, got \`${entry.raw}\``,
        `use \`--answer ${label}=true\` or \`--answer ${label}=false\``,
      );
    }
    return entry.raw === "true";
  }
  if (declared.type === "number") {
    const parsed = Number(entry.raw);
    if (entry.raw.trim() === "" || !Number.isFinite(parsed)) {
      throw new AokitError(
        "INVALID_INPUT",
        `--answer ${label} must be a number, got \`${entry.raw}\``,
        `use \`--answer ${label}=<number>\``,
      );
    }
    return parsed;
  }
  const choices = declared.choices ?? [];
  if (declared.type === "select" && !choices.includes(entry.raw)) {
    throw new AokitError(
      "INVALID_INPUT",
      `--answer ${label} must be one of ${choices.join(", ")}, got \`${entry.raw}\``,
      `use \`--answer ${label}=<${choices.join("|")}>\``,
    );
  }
  return entry.raw;
}

/** Validates every `--answer` against the resolved Modules and coerces it to its declared type. */
export function parseAnswers(
  flags: readonly string[],
  modules: readonly ModuleManifest[],
): AnswerMap {
  const byName = new Map(modules.map((manifest) => [manifest.name, manifest]));
  const answers: AnswerMap = {};
  for (const flag of flags) {
    const entry = parseRawAnswer(flag);
    const manifest = byName.get(entry.module);
    if (manifest === undefined) {
      throw new AokitError(
        "INVALID_INPUT",
        `--answer \`${flag}\` names Module \`${entry.module}\`, which is not selected`,
        `add \`${entry.module}\` to --modules, or drop the answer`,
      );
    }
    const declared = manifest.answers?.[entry.key];
    if (declared === undefined) {
      const known = Object.keys(manifest.answers ?? {}).join(", ") || "none";
      throw new AokitError(
        "INVALID_INPUT",
        `Module \`${entry.module}\` has no answer \`${entry.key}\` (declared: ${known})`,
        `choose one of the declared answers of \`${entry.module}\``,
      );
    }
    (answers[entry.module] ??= {})[entry.key] = coerce(entry, declared);
  }
  return answers;
}

/** Fills schema defaults and fails, naming the flag, for each answer with neither value nor default. */
export function completeAnswers(given: AnswerMap, modules: readonly ModuleManifest[]): AnswerMap {
  const complete: AnswerMap = {};
  for (const manifest of modules) {
    for (const [key, declared] of Object.entries(manifest.answers ?? {})) {
      const value = given[manifest.name]?.[key] ?? declared.default;
      if (value === undefined) {
        throw new AokitError(
          "MISSING_VALUE",
          `missing value for \`--answer ${manifest.name}.${key}=<value>\`${declared.message === undefined ? "" : ` (${declared.message})`}`,
          `pass \`--answer ${manifest.name}.${key}=<value>\``,
        );
      }
      (complete[manifest.name] ??= {})[key] = value;
    }
  }
  return complete;
}
