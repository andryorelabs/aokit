import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDirectory = join(import.meta.dir, "..", "..", ".github", "workflows");
/** The workflow files the `github-ci` Module writes into a generated Project. */
const moduleWorkflowsDirectory = join(
  import.meta.dir,
  "..",
  "..",
  "registry-src",
  "github-ci",
  "files",
  "workflows",
);

/** The S8 hardening rules; every problem names exactly one of them. */
type WorkflowRule =
  | "timeout-minutes"
  | "persist-credentials"
  | "permissions"
  | "no-pull-request-target"
  | "concurrency"
  | "push-branches"
  | "no-expression-in-run"
  | "pinned-actions"
  | "node-version-file"
  | "bun-cache"
  | "no-cache-on-release"
  | "workflow-dispatch"
  | "harden-runner"
  | "steps-call-scripts";

/** The job slot used for problems that belong to the whole workflow rather than one job. */
const workflowScope = "(workflow)";
const pinnedReference = /^[^@\s]+@[0-9a-f]{40}$/;
const exactVersionComment = /^v\d+\.\d+\.\d+$/;
const usesLine = /^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(\S.*?))?\s*$/;
const jobKeyLine = /^ {2}([A-Za-z0-9_-]+):/;
const topLevelLine = /^\S/;
const readOnlyLevels = new Set(["read", "none"]);
const installCommand = /\bbun (?:install|i)\b/;
/** The only `cancel-in-progress` value that cancels superseded runs: true on pull requests, false on `main`. */
const cancelOnPullRequestOnly = "${{ github.event_name == 'pull_request' }}";
/**
 * The group key that keeps runs apart per commit off pull requests. A group shared by every
 * push to `main` lets a newer run cancel the pending one, even with `cancel-in-progress: false`.
 */
const perRunGroupKey = "${{ github.event.pull_request.number || github.sha }}";
/** The one workflow that runs on a push to `main` and not to `develop`. */
const defaultBranchOnlyWorkflow = "scorecard.yml";
/** The workflows a maintainer must be able to rerun by hand on any branch (V28). */
const dispatchWorkflows: ReadonlySet<string> = new Set(["ci.yml", "codeql.yml", "lint-docs.yml"]);
/** The action every job starts with, so its network and process activity is audited (V43). */
const hardenRunnerAction = "step-security/harden-runner@";
const egressPolicies: ReadonlySet<unknown> = new Set(["audit", "block"]);
/**
 * The rules aokit's own workflows follow and a generated Project's workflows need not.
 * `steps-call-scripts` stays repo-only because a generated Project defines its own scripts.
 */
const repoOnlyRules: readonly WorkflowRule[] = [
  "push-branches",
  "workflow-dispatch",
  "harden-runner",
  "steps-call-scripts",
];

/** The `with:` inputs of the shared Bun install cache step every install step must follow. */
const bunCache = {
  path: "~/.bun/install/cache",
  key: "${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}",
  restoreKeys: "${{ runner.os }}-bun-",
} as const;
const bunCacheDescription = `the actions/cache step for ${bunCache.path}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeProblem(file: string, job: string, rule: WorkflowRule, detail: string): string {
  return `${file}:${job} breaks ${rule}: ${detail}`;
}

/** A workflow triggered by a tag push publishes what it builds, so it must not restore a cache. */
function isReleaseWorkflow(workflow: Record<string, unknown>): boolean {
  const on = workflow.on;
  if (!isRecord(on) || !isRecord(on.push)) return false;
  return on.push.tags !== undefined;
}

function listTriggers(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on))
    return on.filter((trigger): trigger is string => typeof trigger === "string");
  if (isRecord(on)) return Object.keys(on);
  return [];
}

/** Flags a `concurrency` block, of a workflow or a job, that can cancel a run on `main`. */
function findCancellationProblems(file: string, scope: string, concurrency: unknown): string[] {
  if (!isRecord(concurrency)) return [];
  const cancel = concurrency["cancel-in-progress"];
  if (cancel === undefined || cancel === false || cancel === cancelOnPullRequestOnly) return [];
  const value = typeof cancel === "string" ? cancel : JSON.stringify(cancel);
  return [
    describeProblem(
      file,
      scope,
      "concurrency",
      `cancel-in-progress is ${value}, which cancels runs on main; use ${cancelOnPullRequestOnly}`,
    ),
  ];
}

/**
 * Every workflow groups its runs. A `pull_request` workflow also keeps one group per run off pull
 * requests and cancels the superseded ones on pull requests only.
 */
function findConcurrencyProblems(file: string, workflow: Record<string, unknown>): string[] {
  const concurrency = workflow.concurrency;
  const cancellationProblems = findCancellationProblems(file, workflowScope, concurrency);
  if (cancellationProblems.length > 0) return cancellationProblems;
  const isPullRequestWorkflow = listTriggers(workflow.on).includes("pull_request");
  const group = isRecord(concurrency) ? concurrency.group : undefined;
  if (typeof group !== "string" || group === "") {
    const kind = isPullRequestWorkflow ? "a pull_request workflow" : "every workflow";
    return [
      describeProblem(
        file,
        workflowScope,
        "concurrency",
        `${kind} must set top-level concurrency with a group`,
      ),
    ];
  }
  if (!isPullRequestWorkflow) return [];
  if (!group.includes(perRunGroupKey)) {
    return [
      describeProblem(
        file,
        workflowScope,
        "concurrency",
        `group ${group} is shared by every run on main, so a newer run cancels the pending one; end it with ${perRunGroupKey}`,
      ),
    ];
  }
  if (isRecord(concurrency) && concurrency["cancel-in-progress"] === cancelOnPullRequestOnly)
    return [];
  return [
    describeProblem(
      file,
      workflowScope,
      "concurrency",
      `a pull_request workflow must cancel superseded runs with cancel-in-progress: ${cancelOnPullRequestOnly}`,
    ),
  ];
}

function listPushBranches(workflow: Record<string, unknown>): unknown[] {
  const on = workflow.on;
  const push = isRecord(on) ? on.push : undefined;
  const branches = isRecord(push) ? push.branches : undefined;
  if (typeof branches === "string") return [branches];
  return Array.isArray(branches) ? branches : [];
}

/**
 * `develop` is the trunk and `main` holds promoted history, so a workflow that runs on a push to
 * `main` also runs on a push to `develop`. The Scorecard workflow is the exception: it stays on
 * the default branch.
 */
function findPushBranchProblems(file: string, workflow: Record<string, unknown>): string[] {
  const branches = listPushBranches(workflow);
  const listsDevelop = branches.includes("develop");
  if (file === defaultBranchOnlyWorkflow) {
    if (!listsDevelop) return [];
    return [
      describeProblem(
        file,
        workflowScope,
        "push-branches",
        "push.branches lists develop, but the Scorecard reads the default branch only",
      ),
    ];
  }
  if (!branches.includes("main") || listsDevelop) return [];
  return [
    describeProblem(
      file,
      workflowScope,
      "push-branches",
      "push.branches lists main without develop; a push to develop must run it too",
    ),
  ];
}

function findWorkflowLevelProblems(file: string, workflow: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const permissions = workflow.permissions;
  if (permissions === undefined) {
    problems.push(
      describeProblem(file, workflowScope, "permissions", "top-level permissions is missing"),
    );
  } else if (!isRecord(permissions)) {
    problems.push(
      describeProblem(
        file,
        workflowScope,
        "permissions",
        "top-level permissions must be a map of read or none scopes",
      ),
    );
  } else {
    for (const [scope, level] of Object.entries(permissions)) {
      if (typeof level === "string" && readOnlyLevels.has(level)) continue;
      problems.push(
        describeProblem(
          file,
          workflowScope,
          "permissions",
          `top-level permissions grants ${scope}: ${String(level)}; grant writes per job`,
        ),
      );
    }
  }
  if (listTriggers(workflow.on).includes("pull_request_target")) {
    problems.push(
      describeProblem(
        file,
        workflowScope,
        "no-pull-request-target",
        "pull_request_target is a trigger",
      ),
    );
  }
  problems.push(...findConcurrencyProblems(file, workflow));
  problems.push(...findPushBranchProblems(file, workflow));
  if (dispatchWorkflows.has(file) && !listTriggers(workflow.on).includes("workflow_dispatch")) {
    problems.push(
      describeProblem(
        file,
        workflowScope,
        "workflow-dispatch",
        "on: lacks workflow_dispatch, so the workflow cannot be rerun by hand",
      ),
    );
  }
  return problems;
}

/** The first step of a job is harden-runner with an explicit egress policy. */
function findHardenRunnerProblems(file: string, job: string, steps: readonly unknown[]): string[] {
  const first = steps[0];
  const uses = isRecord(first) ? first.uses : undefined;
  if (typeof uses !== "string" || !uses.startsWith(hardenRunnerAction)) {
    return [
      describeProblem(
        file,
        job,
        "harden-runner",
        `the first step must be ${hardenRunnerAction.slice(0, -1)}`,
      ),
    ];
  }
  const inputs = isRecord(first) && isRecord(first.with) ? first.with : {};
  if (egressPolicies.has(inputs["egress-policy"])) return [];
  return [
    describeProblem(
      file,
      job,
      "harden-runner",
      "the harden-runner step must set egress-policy: audit or block",
    ),
  ];
}

function stepLabel(step: Record<string, unknown>, index: number): string {
  const name = step.name;
  return typeof name === "string" ? `"${name}"` : `#${index + 1}`;
}

function findStepProblems(
  file: string,
  job: string,
  step: Record<string, unknown>,
  index: number,
): string[] {
  const problems: string[] = [];
  const label = stepLabel(step, index);
  const uses = step.uses;
  const inputs = isRecord(step.with) ? step.with : {};
  if (typeof uses === "string" && uses.startsWith("actions/checkout@")) {
    const persistCredentials = inputs["persist-credentials"];
    if (persistCredentials !== false && persistCredentials !== "false") {
      problems.push(
        describeProblem(
          file,
          job,
          "persist-credentials",
          `checkout step ${label} must set persist-credentials: false`,
        ),
      );
    }
  }
  if (typeof uses === "string" && uses.startsWith("actions/setup-node@")) {
    if (inputs["node-version-file"] !== ".node-version" || inputs["node-version"] !== undefined) {
      problems.push(
        describeProblem(
          file,
          job,
          "node-version-file",
          `setup-node step ${label} must use node-version-file: .node-version and no node-version`,
        ),
      );
    }
  }
  const run = step.run;
  if (typeof run === "string" && run.includes("${{")) {
    problems.push(
      describeProblem(
        file,
        job,
        "no-expression-in-run",
        `step ${label} has \${{ }} inside run:; pass it through env:`,
      ),
    );
  }
  return problems;
}

/** Release workflows build from a clean install: no cache step and no setup action cache. */
function findReleaseCacheProblems(
  file: string,
  job: string,
  step: Record<string, unknown>,
  index: number,
): string[] {
  const uses = step.uses;
  if (typeof uses !== "string") return [];
  const label = stepLabel(step, index);
  const inputs = isRecord(step.with) ? step.with : {};
  const detail = uses.startsWith("actions/cache")
    ? `cache step ${label} restores a cache in a release workflow`
    : uses.startsWith("oven-sh/setup-bun@") && inputs["no-cache"] !== true
      ? `setup-bun step ${label} must set no-cache: true`
      : uses.startsWith("actions/setup-node@") && inputs["package-manager-cache"] !== false
        ? `setup-node step ${label} must set package-manager-cache: false`
        : undefined;
  return detail === undefined ? [] : [describeProblem(file, job, "no-cache-on-release", detail)];
}

function findJobProblems(
  file: string,
  job: string,
  definition: Record<string, unknown>,
  isRelease: boolean,
): string[] {
  const problems: string[] = [];
  const callsReusableWorkflow = definition.uses !== undefined;
  if (!callsReusableWorkflow && definition["timeout-minutes"] === undefined) {
    problems.push(describeProblem(file, job, "timeout-minutes", "job sets no timeout-minutes"));
  }
  problems.push(...findCancellationProblems(file, job, definition.concurrency));
  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  if (!callsReusableWorkflow) problems.push(...findHardenRunnerProblems(file, job, steps));
  steps.forEach((step: unknown, index) => {
    if (!isRecord(step)) return;
    problems.push(...findStepProblems(file, job, step, index));
    problems.push(...findStepScriptProblems(file, job, step, index));
    if (isRelease) problems.push(...findReleaseCacheProblems(file, job, step, index));
  });
  if (!isRelease) problems.push(...findBunCacheProblems(file, job, steps));
  return problems;
}

function isBunCacheStep(step: unknown): boolean {
  if (!isRecord(step)) return false;
  const uses = step.uses;
  if (typeof uses !== "string" || !uses.startsWith("actions/cache@")) return false;
  const inputs = isRecord(step.with) ? step.with : {};
  return (
    inputs.path === bunCache.path &&
    inputs.key === bunCache.key &&
    inputs["restore-keys"] === bunCache.restoreKeys
  );
}

/** Every `bun install` or `bun i` step must come right after the shared Bun cache step. */
function findBunCacheProblems(file: string, job: string, steps: readonly unknown[]): string[] {
  const problems: string[] = [];
  steps.forEach((step: unknown, index) => {
    if (!isRecord(step)) return;
    const run = step.run;
    if (typeof run !== "string" || !installCommand.test(run)) return;
    if (isBunCacheStep(steps[index - 1])) return;
    problems.push(
      describeProblem(
        file,
        job,
        "bun-cache",
        `install step ${stepLabel(step, index)} is not preceded by ${bunCacheDescription}`,
      ),
    );
  });
  return problems;
}

/** A command a CI step may run although it is not a script call, with the reason it may. */
export interface ScriptExemption {
  /** Matches the whole command text, from its first word after any `VAR=value` prefix. */
  readonly command: RegExp;
  readonly reason: string;
}

/**
 * The commands `steps-call-scripts` admits besides a script call. Each entry is as narrow as the
 * workflows allow and carries its own reason; an entry no repo step uses fails the suite.
 */
export const stepsCallScriptsExemptions: readonly ScriptExemption[] = [
  {
    command: /^(?:echo|printf|exit|cd|read|local|return|break|shopt|true|\[)(?:\s|$)/,
    reason: "shell builtins: output, tests and control flow inside a step, not a tool",
  },
  {
    command: /^(?:cat|cp|diff|head|ls|mkdir|mktemp|sleep|sort|tr|wc)(?:\s|$)/,
    reason:
      "coreutils and diffutils present on every runner image, used to move, print and compare step files",
  },
  {
    command: /^(?:awk -v bytes=|sed 's\/\^\/\* \/')/,
    reason: "one-expression text formatting: the binary size in MiB and the allowed signers file",
  },
  {
    command: /^sha256sum /,
    reason:
      "coreutils checksums of the release binaries and the actionlint download; release-workflow.test.ts runs the Write SHA256SUMS step body in bash",
  },
  {
    command: /^jq -r \.(?:version|dependencies\.aokit) packages\/[\w-]+\/package\.json$/,
    reason:
      "reads the package versions in release.yml's Resolve step; release-workflow.test.ts runs that step body in bash, so it stays inline",
  },
  {
    command: /^bun (?:install|i)(?:\s|$)/,
    reason: "installs the dependencies every script needs, so no script can run before it",
  },
  {
    command: /^bun test \S/,
    reason:
      "runs one test path or subset; the test script always runs the whole suite under the coverage gate",
  },
  {
    command: /^bun pm pack --destination /,
    reason: "packs one workspace package from its own directory into the release tarballs",
  },
  {
    command: /^bunx "(?:aokit|create-aokit)@\$VERSION" /,
    reason: "smoke-runs the version just published to npm, which no local script reaches",
  },
  {
    command: /^git config --global core\.autocrlf false$/,
    reason: "keeps LF line endings on Windows; it runs before checkout, so no script exists yet",
  },
  {
    command:
      /^git (?:merge-base --is-ancestor |fetch --quiet --no-tags |cat-file -t |rev-parse "refs\/tags\/|-c gpg\.ssh\.allowedSignersFile=)/,
    reason:
      "the release tag gate (on main, annotated, signed) stays inline in release.yml, where release-gates.test.ts asserts it runs before any build",
  },
  {
    command: /^gh api (?:"users\/\$ACTOR\/(?:ssh_signing_keys|gpg_keys)"|--method GET "repos\/)/,
    reason:
      "reads the tagger's signing keys and the tagged commit's CI result with the job token, inside the inline release gates",
  },
  {
    command: /^gh release (?:create|upload) "v\$VERSION" /,
    reason:
      "creates the GitHub Release and attaches its assets; release-workflow.test.ts runs these step bodies in bash",
  },
  {
    command: /^gpg --batch --quiet --import$/,
    reason: "imports the tagger's GPG keys so git verify-tag can check the release tag",
  },
  {
    command: /^npm (?:--version$|view "|publish "\$tarball")/,
    reason: "npm trusted publishing with provenance needs the npm CLI, which bun does not replace",
  },
  {
    command: /^curl --fail .*\/rhysd\/actionlint\/releases\/download\//,
    reason: "downloads the pinned actionlint release; the next command checks its SHA-256",
  },
  {
    command: /^tar --extract .* actionlint$/,
    reason: "unpacks the checksum-verified actionlint binary into the runner temp directory",
  },
  {
    command: /^"\$\{RUNNER_TEMP\}\/actionlint" /,
    reason:
      "runs actionlint, a Go binary the step before installs; it is not a package a script could call",
  },
  {
    command: /^pipx install "zizmor==\$\{ZIZMOR_VERSION\}"$/,
    reason: "zizmor ships on PyPI only, at the version Renovate pins in the step env",
  },
  {
    command: /^zizmor /,
    reason:
      "runs zizmor, a Python tool the step before installs; it is not a package a script could call",
  },
];

/** A script call: a `package.json` script through `bun run`, or a repo script under `tools/`. */
const scriptCall = /^bun (?:run (?:--[\w-]+ )*[\w:-]+|tools\/[\w./-]+\.ts)(?:\s|$)/;
const commandSeparator = /[|;&()\n]/;
/** Words that open, continue or close a compound command; the command starts after them. */
const reservedWords: ReadonlySet<string> = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "while",
  "until",
  "esac",
  "{",
  "}",
  "!",
  "time",
]);
/** Words whose clause holds no command: `for x in list` and `case word in`. */
const clauseWords: ReadonlySet<string> = new Set(["for", "case", "select"]);
const assignmentWord = /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/;
const redirectionOperator = /^\d*(?:<<<|<<-?|>>|<>|>&|<&|>\||<|>)$/;
const attachedRedirection = /^\d*(?:<<<|<<-?|>>|<>|>&|<&|>\||<|>)\S/;
const heredocStart = /(?<!<)<<-?\s*(['"]?)([A-Za-z_]\w*)\1/;
const casePatterns = /(\bin\b|;;)(\s*)([^;()\n]*\))/g;
const arrayAssignmentStart = /[A-Za-z_]\w*\+?=\(/g;
const functionDefinition = /(?:^|[\n;&|{}])\s*([A-Za-z_][\w-]*)\s*\(\s*\)/g;

interface MaskedScript {
  /** The scanned text, same length, with quoted text, substitutions and comments masked. */
  readonly masked: string;
  /** The text inside each top-level `$( )`, scanned on its own afterwards. */
  readonly substitutions: readonly string[];
  /** The index the scan stopped at: the closing `)` of a substitution, or the end of the text. */
  readonly end: number;
}

/** Drops heredoc bodies, which are data and may hold anything that looks like a command. */
function removeHeredocBodies(script: string): string {
  const kept: string[] = [];
  let terminator: string | undefined;
  for (const line of script.split("\n")) {
    if (terminator !== undefined) {
      if (line.trim() === terminator) terminator = undefined;
      continue;
    }
    kept.push(line);
    terminator = heredocStart.exec(line)?.[2];
  }
  return kept.join("\n");
}

/** `width` copies of `character`: the mask for that many characters of a scanned script. */
function maskSpan(width: number, character = "x"): string {
  return character.repeat(width);
}

/**
 * Scans `text` from `start`, masking quoted text, `${ }` expansions, comments and `$( )`
 * substitutions with `x` so separators inside them do not split commands. With
 * `insideSubstitution`, the scan stops at the `)` that closes the substitution.
 */
function maskShell(text: string, start: number, insideSubstitution: boolean): MaskedScript {
  let masked = "";
  const substitutions: string[] = [];
  let quote: "'" | '"' | undefined;
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const character = text[index] ?? "";
    const next = text[index + 1] ?? "";
    let width = 1;
    let replacement: string | undefined = "x";
    if (quote === "'") {
      if (character === "'") quote = undefined;
    } else if (character === "\\") {
      width = Math.min(2, text.length - index);
    } else if (character === "$" && next === "(") {
      const inner = maskShell(text, index + 2, true);
      substitutions.push(text.slice(index + 2, inner.end));
      width = Math.min(inner.end + 1, text.length) - index;
    } else if (character === "$" && next === "{") {
      const close = text.indexOf("}", index);
      width = (close === -1 ? text.length : close + 1) - index;
    } else if (quote === '"') {
      if (character === '"') quote = undefined;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "#" && (index === start || /\s/.test(text[index - 1] ?? ""))) {
      const newline = text.indexOf("\n", index);
      width = (newline === -1 ? text.length : newline) - index;
      replacement = " ";
    } else if (character === ")" && insideSubstitution && depth === 0) {
      return { masked, substitutions, end: index };
    } else {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      replacement = undefined;
    }
    masked += replacement === undefined ? character : maskSpan(width, replacement);
    index += width;
  }
  return { masked, substitutions, end: index };
}

/** Blanks `case` patterns such as `success | skipped)`, whose `|` and `)` are not separators. */
function maskCasePatterns(masked: string): string {
  return masked.replace(
    casePatterns,
    (_match, keyword: string, space: string, patterns: string) =>
      `${keyword}${space}${maskSpan(patterns.length, " ")}`,
  );
}

/** Masks the list of an array assignment such as `flags=(--repo x)`, so it reads as one word. */
function maskArrayAssignments(masked: string): string {
  let result = masked;
  for (const match of masked.matchAll(arrayAssignmentStart)) {
    const open = match.index + match[0].length - 1;
    const close = result.indexOf(")", open);
    const stop = close === -1 ? result.length : close + 1;
    result = `${result.slice(0, open)}${maskSpan(stop - open)}${result.slice(stop)}`;
  }
  return result;
}

/** The command in `script[start..end]`: from its first word after reserved words, assignments and redirections. */
function commandIn(
  script: string,
  masked: string,
  span: { start: number; end: number },
  functions: ReadonlySet<string>,
): string | undefined {
  const segment = masked.slice(span.start, span.end);
  const words = [...segment.matchAll(/\S+/g)];
  let position = 0;
  while (position < words.length) {
    const word = words[position]?.[0] ?? "";
    if (clauseWords.has(word)) return undefined;
    if (redirectionOperator.test(word)) {
      position += 2;
    } else if (
      reservedWords.has(word) ||
      assignmentWord.test(word) ||
      attachedRedirection.test(word)
    ) {
      position += 1;
    } else {
      break;
    }
  }
  const head = words[position];
  if (head === undefined) return undefined;
  const headStart = span.start + head.index;
  if (functions.has(script.slice(headStart, headStart + head[0].length))) return undefined;
  const length = masked.slice(headStart, span.end).trimEnd().length;
  return script.slice(headStart, headStart + length);
}

/** Lists the commands of a shell script whose heredoc bodies are gone and lines are joined. */
function listScriptCommands(script: string): string[] {
  const { masked: quoted, substitutions } = maskShell(script, 0, false);
  const masked = maskArrayAssignments(maskCasePatterns(quoted));
  const functions = new Set(
    [...masked.matchAll(functionDefinition)].map((match) => match[1] ?? ""),
  );
  const commands: string[] = [];
  let start = 0;
  for (let index = 0; index <= masked.length; index += 1) {
    if (index < masked.length && !commandSeparator.test(masked[index] ?? "")) continue;
    const command = commandIn(script, masked, { start, end: index }, functions);
    if (command !== undefined) commands.push(command);
    start = index + 1;
  }
  return [...commands, ...substitutions.flatMap(listScriptCommands)];
}

/**
 * Lists every command a `run:` script executes, each from its first word: commands joined by
 * `&&`, `||`, `|` and `;`, inside `if`, loops and groups, and inside `$( )` substitutions.
 * Heredoc bodies, `case` patterns, array lists and calls to functions the script defines are not
 * commands. A shell parser in miniature: enough for the workflows this repo writes.
 */
export function listStepCommands(run: string): string[] {
  const script = removeHeredocBodies(run.replaceAll("\r\n", "\n")).replaceAll("\\\n", "  ");
  return listScriptCommands(script);
}

/**
 * The `steps-call-scripts` rule (V32): a step calls `bun run <script>` or a repo script under
 * `tools/`, never a raw tool such as `bunx commitlint`, unless {@link stepsCallScriptsExemptions}
 * admits the command with a reason.
 */
export function findStepScriptProblems(
  file: string,
  job: string,
  step: Record<string, unknown>,
  index: number,
): string[] {
  const run = step.run;
  if (typeof run !== "string") return [];
  return listStepCommands(run)
    .filter(
      (command) =>
        !scriptCall.test(command) &&
        !stepsCallScriptsExemptions.some((exemption) => exemption.command.test(command)),
    )
    .map((command) =>
      describeProblem(
        file,
        job,
        "steps-call-scripts",
        `step ${stepLabel(step, index)} runs \`${command}\` directly; call bun run <script>, or exempt the command with a reason`,
      ),
    );
}

/** Scans the raw text because the version comment after a `uses:` is lost when the YAML is parsed. */
function findPinningProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  let insideJobs = false;
  let job = workflowScope;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (topLevelLine.test(line)) {
      insideJobs = line === "jobs:";
      job = workflowScope;
      continue;
    }
    const jobMatch = insideJobs ? jobKeyLine.exec(line) : null;
    if (jobMatch !== null) job = jobMatch[1] ?? workflowScope;
    const usesMatch = usesLine.exec(line);
    if (usesMatch === null) continue;
    const [, reference = "", versionComment] = usesMatch;
    if (reference.startsWith("./")) continue;
    if (!pinnedReference.test(reference)) {
      problems.push(
        describeProblem(
          file,
          job,
          "pinned-actions",
          `${reference} is not pinned to a 40-character SHA`,
        ),
      );
    } else if (versionComment === undefined || !exactVersionComment.test(versionComment)) {
      problems.push(
        describeProblem(
          file,
          job,
          "pinned-actions",
          `${reference} lacks a # vX.Y.Z version comment`,
        ),
      );
    }
  }
  return problems;
}

/** Returns one `<file>:<job> breaks <rule>: <detail>` line per S8 rule a workflow breaks. */
export function findWorkflowProblems(file: string, text: string): string[] {
  const workflow: unknown = Bun.YAML.parse(text);
  if (!isRecord(workflow)) throw new Error(`${file} is not a YAML mapping`);
  const jobs = isRecord(workflow.jobs) ? workflow.jobs : {};
  const isRelease = isReleaseWorkflow(workflow);
  const jobProblems = Object.entries(jobs).flatMap(([job, definition]) =>
    isRecord(definition) ? findJobProblems(file, job, definition, isRelease) : [],
  );
  return [
    ...findWorkflowLevelProblems(file, workflow),
    ...jobProblems,
    ...findPinningProblems(file, text),
  ];
}

function breaksAny(problem: string, rules: readonly WorkflowRule[]): boolean {
  return rules.some((rule) => problem.includes(` breaks ${rule}: `));
}

/**
 * The rules a `github-ci` Module workflow must follow: every rule except the repo-only ones. A
 * generated Project chooses its own trunk, and harden-runner and manual dispatch are aokit's own
 * choices there.
 */
function findModuleWorkflowProblems(file: string, text: string): string[] {
  return findWorkflowProblems(file, text).filter((problem) => !breaksAny(problem, repoOnlyRules));
}

function readModuleWorkflows(): { name: string; text: string }[] {
  return readdirSync(moduleWorkflowsDirectory)
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted()
    .map((name) => ({ name, text: readFileSync(join(moduleWorkflowsDirectory, name), "utf8") }));
}

const sha = "a".repeat(40);

const fixtureHardenStep = `      - uses: step-security/harden-runner@${sha} # v2.22.4
        with:
          egress-policy: audit
`;

const fixtureConcurrency = `concurrency:
  group: fixture-\${{ github.workflow }}-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}
`;

const fixtureCacheStep = `      - uses: actions/cache@${sha} # v6.1.0
        with:
          path: ${bunCache.path}
          key: ${bunCache.key}
          restore-keys: ${bunCache.restoreKeys}
`;

const validWorkflow = `name: Fixture

on:
  pull_request:

permissions:
  contents: read

${fixtureConcurrency}
jobs:
  build:
    name: build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
    steps:
${fixtureHardenStep}
      - uses: actions/checkout@${sha} # v7.0.1
        with:
          persist-credentials: false

      - uses: actions/setup-node@${sha} # v7.1.0
        with:
          node-version-file: .node-version

${fixtureCacheStep}
      - name: Install
        run: bun install --frozen-lockfile

      - name: Print ref
        env:
          REF: \${{ github.ref }}
        run: echo "$REF"
`;

/** A second fixture job named `other`: `before`, then harden-runner, then `body`. */
function secondJob(body: string, before = ""): string {
  return `  other:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n${before}${fixtureHardenStep}${body}`;
}

function breakFixture(search: string, replacement: string): string {
  expect(validWorkflow).toContain(search);
  return validWorkflow.replace(search, replacement);
}

const brokenFixtures: readonly {
  rule: WorkflowRule;
  search: string;
  replacement: string;
  expected: string;
}[] = [
  {
    rule: "timeout-minutes",
    search: "    timeout-minutes: 10\n",
    replacement: "",
    expected: "fixture.yml:build breaks timeout-minutes: job sets no timeout-minutes",
  },
  {
    rule: "persist-credentials",
    search: "          persist-credentials: false\n",
    replacement: "          persist-credentials: true\n",
    expected:
      "fixture.yml:build breaks persist-credentials: checkout step #2 must set persist-credentials: false",
  },
  {
    rule: "permissions",
    search: "\npermissions:\n  contents: read\n",
    replacement: "",
    expected: "fixture.yml:(workflow) breaks permissions: top-level permissions is missing",
  },
  {
    rule: "permissions",
    search: "  contents: read\n\nconcurrency:",
    replacement: "  contents: write\n\nconcurrency:",
    expected:
      "fixture.yml:(workflow) breaks permissions: top-level permissions grants contents: write; grant writes per job",
  },
  {
    rule: "permissions",
    search: "permissions:\n  contents: read\n\nconcurrency:",
    replacement: "permissions: write-all\n\nconcurrency:",
    expected:
      "fixture.yml:(workflow) breaks permissions: top-level permissions must be a map of read or none scopes",
  },
  {
    rule: "no-pull-request-target",
    search: "on:\n  pull_request:\n",
    replacement: "on:\n  pull_request_target:\n",
    expected:
      "fixture.yml:(workflow) breaks no-pull-request-target: pull_request_target is a trigger",
  },
  {
    rule: "concurrency",
    search: `${fixtureConcurrency}\n`,
    replacement: "",
    expected:
      "fixture.yml:(workflow) breaks concurrency: a pull_request workflow must set top-level concurrency with a group",
  },
  {
    rule: "concurrency",
    search:
      "  group: fixture-${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}\n",
    replacement: "",
    expected:
      "fixture.yml:(workflow) breaks concurrency: a pull_request workflow must set top-level concurrency with a group",
  },
  {
    rule: "concurrency",
    search: "${{ github.event.pull_request.number || github.sha }}",
    replacement: "${{ github.ref }}",
    expected:
      "fixture.yml:(workflow) breaks concurrency: group fixture-${{ github.workflow }}-${{ github.ref }} is shared by every run on main, so a newer run cancels the pending one; end it with ${{ github.event.pull_request.number || github.sha }}",
  },
  {
    rule: "concurrency",
    search: "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    replacement: "cancel-in-progress: true",
    expected:
      "fixture.yml:(workflow) breaks concurrency: cancel-in-progress is true, which cancels runs on main; use ${{ github.event_name == 'pull_request' }}",
  },
  {
    rule: "concurrency",
    search: "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    replacement: "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
    expected:
      "fixture.yml:(workflow) breaks concurrency: cancel-in-progress is ${{ github.ref != 'refs/heads/main' }}, which cancels runs on main; use ${{ github.event_name == 'pull_request' }}",
  },
  {
    rule: "concurrency",
    search: "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    replacement: "cancel-in-progress: false",
    expected:
      "fixture.yml:(workflow) breaks concurrency: a pull_request workflow must cancel superseded runs with cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
  },
  {
    rule: "concurrency",
    search: "    timeout-minutes: 10\n",
    replacement:
      "    timeout-minutes: 10\n    concurrency:\n      group: build\n      cancel-in-progress: true\n",
    expected:
      "fixture.yml:build breaks concurrency: cancel-in-progress is true, which cancels runs on main; use ${{ github.event_name == 'pull_request' }}",
  },
  {
    rule: "push-branches",
    search: "on:\n  pull_request:\n",
    replacement: "on:\n  push:\n    branches: [main]\n  pull_request:\n",
    expected:
      "fixture.yml:(workflow) breaks push-branches: push.branches lists main without develop; a push to develop must run it too",
  },
  {
    rule: "push-branches",
    search: "on:\n  pull_request:\n",
    replacement: "on:\n  push:\n    branches: main\n  pull_request:\n",
    expected:
      "fixture.yml:(workflow) breaks push-branches: push.branches lists main without develop; a push to develop must run it too",
  },
  {
    rule: "no-expression-in-run",
    search: 'run: echo "$REF"',
    replacement: 'run: echo "${{ github.ref }}"',
    expected:
      'fixture.yml:build breaks no-expression-in-run: step "Print ref" has ${{ }} inside run:; pass it through env:',
  },
  {
    rule: "pinned-actions",
    search: `actions/checkout@${sha} # v7.0.1`,
    replacement: "actions/checkout@v7",
    expected:
      "fixture.yml:build breaks pinned-actions: actions/checkout@v7 is not pinned to a 40-character SHA",
  },
  {
    rule: "pinned-actions",
    search: `actions/checkout@${sha} # v7.0.1`,
    replacement: `actions/checkout@${sha} # v7`,
    expected: `fixture.yml:build breaks pinned-actions: actions/checkout@${sha} lacks a # vX.Y.Z version comment`,
  },
  {
    rule: "pinned-actions",
    search: `actions/checkout@${sha} # v7.0.1`,
    replacement: `actions/checkout@${sha}`,
    expected: `fixture.yml:build breaks pinned-actions: actions/checkout@${sha} lacks a # vX.Y.Z version comment`,
  },
  {
    rule: "node-version-file",
    search: "node-version-file: .node-version",
    replacement: "node-version: 24",
    expected:
      "fixture.yml:build breaks node-version-file: setup-node step #3 must use node-version-file: .node-version and no node-version",
  },
  {
    rule: "harden-runner",
    search: `${fixtureHardenStep}\n`,
    replacement: "",
    expected:
      "fixture.yml:build breaks harden-runner: the first step must be step-security/harden-runner",
  },
  {
    rule: "harden-runner",
    search: `${fixtureHardenStep}\n      - uses: actions/checkout@${sha} # v7.0.1\n        with:\n          persist-credentials: false\n`,
    replacement: `      - uses: actions/checkout@${sha} # v7.0.1\n        with:\n          persist-credentials: false\n\n${fixtureHardenStep}`,
    expected:
      "fixture.yml:build breaks harden-runner: the first step must be step-security/harden-runner",
  },
  {
    rule: "harden-runner",
    search: "          egress-policy: audit\n",
    replacement: "          disable-sudo: true\n",
    expected:
      "fixture.yml:build breaks harden-runner: the harden-runner step must set egress-policy: audit or block",
  },
  {
    rule: "pinned-actions",
    search: `step-security/harden-runner@${sha} # v2.22.4`,
    replacement: "step-security/harden-runner@v2",
    expected:
      "fixture.yml:build breaks pinned-actions: step-security/harden-runner@v2 is not pinned to a 40-character SHA",
  },
  {
    rule: "bun-cache",
    search: `${fixtureCacheStep}\n`,
    replacement: "",
    expected: `fixture.yml:build breaks bun-cache: install step "Install" is not preceded by ${bunCacheDescription}`,
  },
  {
    rule: "bun-cache",
    search: "path: ~/.bun/install/cache",
    replacement: "path: node_modules",
    expected: `fixture.yml:build breaks bun-cache: install step "Install" is not preceded by ${bunCacheDescription}`,
  },
  {
    rule: "bun-cache",
    search: `          restore-keys: ${bunCache.restoreKeys}\n`,
    replacement: "",
    expected: `fixture.yml:build breaks bun-cache: install step "Install" is not preceded by ${bunCacheDescription}`,
  },
  {
    rule: "steps-call-scripts",
    search: 'run: echo "$REF"',
    replacement: 'run: bunx commitlint --from "$REF" --to HEAD',
    expected:
      'fixture.yml:build breaks steps-call-scripts: step "Print ref" runs `bunx commitlint --from "$REF" --to HEAD` directly; call bun run <script>, or exempt the command with a reason',
  },
];

describe("S8: workflow hardening invariants", () => {
  test("every workflow in .github/workflows follows every rule", () => {
    const files = readdirSync(workflowsDirectory).filter((name) => /\.ya?ml$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    const problems = files.flatMap((name) =>
      findWorkflowProblems(name, readFileSync(join(workflowsDirectory, name), "utf8")),
    );
    expect(problems).toEqual([]);
  });

  test("the valid fixture passes", () => {
    expect(findWorkflowProblems("fixture.yml", validWorkflow)).toEqual([]);
  });

  test.each(brokenFixtures)(
    "a fixture breaking $rule fails naming the file, job and rule",
    ({ search, replacement, expected }) => {
      expect(findWorkflowProblems("fixture.yml", breakFixture(search, replacement))).toEqual([
        expected,
      ]);
    },
  );

  test("S3: a workflow that runs on a push to main and to develop passes", () => {
    const text = breakFixture(
      "on:\n  pull_request:\n",
      "on:\n  push:\n    branches: [main, develop]\n  pull_request:\n",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([]);
  });

  test("S3: scorecard.yml stays on main, and listing develop there fails", () => {
    const onMain = breakFixture(
      "on:\n  pull_request:\n",
      "on:\n  push:\n    branches: [main]\n  pull_request:\n",
    );
    expect(findWorkflowProblems("scorecard.yml", onMain)).toEqual([]);
    const onDevelop = breakFixture(
      "on:\n  pull_request:\n",
      "on:\n  push:\n    branches: [main, develop]\n  pull_request:\n",
    );
    expect(findWorkflowProblems("scorecard.yml", onDevelop)).toEqual([
      "scorecard.yml:(workflow) breaks push-branches: push.branches lists develop, but the Scorecard reads the default branch only",
    ]);
  });

  test("S3: every workflow with a branch push trigger runs on main and develop, except scorecard.yml", () => {
    const pushBranches = Object.fromEntries(
      readdirSync(workflowsDirectory)
        .filter((name) => /\.ya?ml$/.test(name))
        .toSorted()
        .flatMap((name): [string, unknown[]][] => {
          const workflow: unknown = Bun.YAML.parse(
            readFileSync(join(workflowsDirectory, name), "utf8"),
          );
          const branches = isRecord(workflow) ? listPushBranches(workflow) : [];
          return branches.length === 0 ? [] : [[name, branches]];
        }),
    );
    expect(pushBranches).toEqual({
      "ci.yml": ["main", "develop"],
      "codeql.yml": ["main", "develop"],
      "determinism.yml": ["main", "develop"],
      "distribution.yml": ["main", "develop"],
      "docker.yml": ["main", "develop"],
      "labels.yml": ["main", "develop"],
      "lint-docs.yml": ["main", "develop"],
      "lint-workflows.yml": ["main", "develop"],
      "real-build.yml": ["main", "develop"],
      "scorecard.yml": ["main"],
      "upgrade.yml": ["main", "develop"],
    });
  });

  test("pull_request_target is caught in list form", () => {
    const text = breakFixture("on:\n  pull_request:\n", "on: [push, pull_request_target]\n");
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      "fixture.yml:(workflow) breaks no-pull-request-target: pull_request_target is a trigger",
    ]);
  });

  test("an empty top-level permissions map passes", () => {
    const text = breakFixture(
      "permissions:\n  contents: read\n\nconcurrency:",
      "permissions: {}\n\nconcurrency:",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([]);
  });

  test("a job calling a reusable workflow needs no timeout-minutes", () => {
    const text = `${validWorkflow}  reuse:\n    uses: ./.github/workflows/other.yml\n`;
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([]);
  });

  test("an install step with extra flags and a cache right before it passes", () => {
    const text = breakFixture(
      "run: bun install --frozen-lockfile\n",
      "run: bun install --frozen-lockfile --ignore-scripts\n",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([]);
  });

  test("a step between the cache and the install step fails", () => {
    const text = breakFixture(
      "      - name: Install\n",
      "      - name: Between\n        run: true\n\n      - name: Install\n",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      `fixture.yml:build breaks bun-cache: install step "Install" is not preceded by ${bunCacheDescription}`,
    ]);
  });

  test.each(["bun i --frozen-lockfile", "bun install"])(
    'the install form "%s" without a cache step is caught',
    (install) => {
      const text = `${validWorkflow}${secondJob(`      - run: ${install}\n`)}`;
      expect(findWorkflowProblems("fixture.yml", text)).toEqual([
        `fixture.yml:other breaks bun-cache: install step #2 is not preceded by ${bunCacheDescription}`,
      ]);
    },
  );

  test("an install step in a second job without a cache names that job", () => {
    const text = `${validWorkflow}${secondJob("      - run: bun install --frozen-lockfile\n")}`;
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      `fixture.yml:other breaks bun-cache: install step #2 is not preceded by ${bunCacheDescription}`,
    ]);
  });

  describe("S5: manual dispatch and concurrency", () => {
    test.each(["ci.yml", "codeql.yml", "lint-docs.yml"])(
      "%s without workflow_dispatch fails naming the file",
      (file) => {
        expect(findWorkflowProblems(file, validWorkflow)).toEqual([
          `${file}:(workflow) breaks workflow-dispatch: on: lacks workflow_dispatch, so the workflow cannot be rerun by hand`,
        ]);
      },
    );

    test("ci.yml with workflow_dispatch passes", () => {
      const text = breakFixture(
        "on:\n  pull_request:\n",
        "on:\n  pull_request:\n  workflow_dispatch:\n",
      );
      expect(findWorkflowProblems("ci.yml", text)).toEqual([]);
    });

    test("a workflow outside the dispatch list needs no workflow_dispatch", () => {
      expect(findWorkflowProblems("lint-pr.yml", validWorkflow)).toEqual([]);
    });

    test.each([
      ["a push", "on:\n  push:\n    branches: [main, develop]\n"],
      ["a schedule", 'on:\n  schedule:\n    - cron: "0 0 * * 1"\n'],
    ])("a workflow on %s without concurrency fails naming it", (_trigger, on) => {
      const text = breakFixture("on:\n  pull_request:\n", on).replace(
        `${fixtureConcurrency}\n`,
        "",
      );
      expect(findWorkflowProblems("labels.yml", text)).toEqual([
        "labels.yml:(workflow) breaks concurrency: every workflow must set top-level concurrency with a group",
      ]);
    });

    test("a workflow on a push with a concurrency group passes", () => {
      const text = breakFixture(
        "on:\n  pull_request:\n",
        "on:\n  push:\n    branches: [main, develop]\n",
      );
      expect(findWorkflowProblems("labels.yml", text)).toEqual([]);
    });

    test("every repo workflow has a concurrency group and the dispatch list accepts dispatch", () => {
      const workflows = readdirSync(workflowsDirectory)
        .filter((name) => /\.ya?ml$/.test(name))
        .map((name) => ({
          name,
          workflow: Bun.YAML.parse(readFileSync(join(workflowsDirectory, name), "utf8")),
        }));
      const withoutGroup = workflows
        .filter(({ workflow }) => {
          const concurrency = isRecord(workflow) ? workflow.concurrency : undefined;
          return !isRecord(concurrency) || typeof concurrency.group !== "string";
        })
        .map(({ name }) => name);
      expect(withoutGroup).toEqual([]);
      const dispatched = workflows
        .filter(
          ({ name, workflow }) =>
            dispatchWorkflows.has(name) &&
            isRecord(workflow) &&
            listTriggers(workflow.on).includes("workflow_dispatch"),
        )
        .map(({ name }) => name)
        .toSorted();
      expect(dispatched).toEqual(["ci.yml", "codeql.yml", "lint-docs.yml"]);
    });
  });

  test("S5: the ci test job writes a JUnit report and uploads it only when it fails", () => {
    const workflow: unknown = Bun.YAML.parse(
      readFileSync(join(workflowsDirectory, "ci.yml"), "utf8"),
    );
    const jobs = isRecord(workflow) && isRecord(workflow.jobs) ? workflow.jobs : {};
    const testJob = jobs.test;
    const steps: Record<string, unknown>[] = (
      isRecord(testJob) && Array.isArray(testJob.steps) ? testJob.steps : []
    ).filter(isRecord);
    const testSteps = steps.filter(
      (step) => typeof step.run === "string" && step.run.startsWith("bun "),
    );
    expect(testSteps.map((step) => step.run)).toEqual([
      "bun install --frozen-lockfile",
      "bun run test",
      "bun test packages tools",
    ]);
    for (const step of testSteps.slice(1)) {
      expect(step.env).toEqual({
        BUN_OPTIONS: "--reporter=junit --reporter-outfile=${{ runner.temp }}/junit.xml",
      });
    }
    const uploads = steps.filter(
      (step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"),
    );
    expect(uploads).toHaveLength(1);
    const [upload] = uploads;
    expect(upload?.if).toBe("failure()");
    expect(upload?.with).toEqual({
      name: "test-report-${{ matrix.os }}-bun-${{ matrix.bun }}",
      path: "${{ runner.temp }}/junit.xml\ncoverage/lcov.info\n",
      "if-no-files-found": "ignore",
      "retention-days": 7,
    });
  });

  describe("S7: harden-runner first in every job", () => {
    test("a second job without harden-runner fails naming that job", () => {
      const text = `${validWorkflow}  other:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: true\n`;
      expect(findWorkflowProblems("fixture.yml", text)).toEqual([
        "fixture.yml:other breaks harden-runner: the first step must be step-security/harden-runner",
      ]);
    });

    test("a job with no steps fails", () => {
      const text = `${validWorkflow}  other:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps: []\n`;
      expect(findWorkflowProblems("fixture.yml", text)).toEqual([
        "fixture.yml:other breaks harden-runner: the first step must be step-security/harden-runner",
      ]);
    });

    test("any other step before harden-runner fails", () => {
      const text = `${validWorkflow}${secondJob("", "      - run: echo first\n")}`;
      expect(findWorkflowProblems("fixture.yml", text)).toEqual([
        "fixture.yml:other breaks harden-runner: the first step must be step-security/harden-runner",
      ]);
    });

    test("every job of every repo workflow starts with a pinned harden-runner in audit mode", () => {
      const firstSteps = readdirSync(workflowsDirectory)
        .filter((name) => /\.ya?ml$/.test(name))
        .toSorted()
        .flatMap((name) => {
          const workflow: unknown = Bun.YAML.parse(
            readFileSync(join(workflowsDirectory, name), "utf8"),
          );
          const jobs = isRecord(workflow) && isRecord(workflow.jobs) ? workflow.jobs : {};
          return Object.entries(jobs).map(([job, definition]) => {
            const steps =
              isRecord(definition) && Array.isArray(definition.steps) ? definition.steps : [];
            const first: unknown = steps[0];
            const inputs = isRecord(first) && isRecord(first.with) ? first.with : {};
            return `${name}:${job} ${isRecord(first) ? String(first.uses) : "none"} ${String(inputs["egress-policy"])}`;
          });
        });
      expect(firstSteps.length).toBeGreaterThan(0);
      expect(
        firstSteps.filter(
          (line) =>
            !line.endsWith(
              " step-security/harden-runner@1d88384fd173af6ecb012dfd0264a306b711241a audit",
            ),
        ),
      ).toEqual([]);
    });
  });

  describe("S7: dependency review on pull requests", () => {
    const text = readFileSync(join(workflowsDirectory, "dependency-review.yml"), "utf8");
    const workflow: unknown = Bun.YAML.parse(text);

    test("runs on pull requests only, read-only", () => {
      expect(isRecord(workflow) ? listTriggers(workflow.on) : []).toEqual(["pull_request"]);
      expect(isRecord(workflow) ? workflow.permissions : undefined).toEqual({
        contents: "read",
      });
    });

    test("its job runs the pinned dependency-review-action after harden-runner", () => {
      const jobs = isRecord(workflow) && isRecord(workflow.jobs) ? workflow.jobs : {};
      const review = jobs["dependency-review"];
      const steps = isRecord(review) && Array.isArray(review.steps) ? review.steps : [];
      const uses = steps.map((step: unknown) => (isRecord(step) ? step.uses : undefined));
      expect(uses).toContain(
        "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
      );
      expect(isRecord(review) ? review.name : undefined).toBe("dependency-review");
    });
  });

  describe("a workflow triggered by a tag push", () => {
    const releaseWorkflow = `name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: read

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
${fixtureHardenStep}
      - uses: oven-sh/setup-bun@${sha} # v2.2.0
        with:
          no-cache: true

      - uses: actions/setup-node@${sha} # v7.1.0
        with:
          node-version-file: .node-version
          package-manager-cache: false

      - name: Install
        run: bun install --frozen-lockfile
`;

    function breakRelease(search: string, replacement: string): string {
      expect(releaseWorkflow).toContain(search);
      return releaseWorkflow.replace(search, replacement);
    }

    test("fails when it cancels in-progress runs", () => {
      const text = breakRelease("cancel-in-progress: false", "cancel-in-progress: true");
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:(workflow) breaks concurrency: cancel-in-progress is true, which cancels runs on main; use ${{ github.event_name == 'pull_request' }}",
      ]);
    });

    test("S5: fails without a concurrency group", () => {
      const text = breakRelease(
        "concurrency:\n  group: release\n  cancel-in-progress: false\n\n",
        "",
      );
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:(workflow) breaks concurrency: every workflow must set top-level concurrency with a group",
      ]);
    });

    test("queues runs with cancel-in-progress: false, installs without a cache step and with setup caches off", () => {
      expect(findWorkflowProblems("release.yml", releaseWorkflow)).toEqual([]);
    });

    test("fails when it restores the Bun cache before installing", () => {
      const text = breakRelease(
        "      - name: Install\n",
        `${fixtureCacheStep}\n      - name: Install\n`,
      );
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:verify breaks no-cache-on-release: cache step #4 restores a cache in a release workflow",
      ]);
    });

    test("fails when setup-bun keeps its cache", () => {
      const text = breakRelease("          no-cache: true\n", "          bun-version: latest\n");
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:verify breaks no-cache-on-release: setup-bun step #2 must set no-cache: true",
      ]);
    });

    test("fails when setup-node keeps its package manager cache", () => {
      const text = breakRelease("          package-manager-cache: false\n", "");
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:verify breaks no-cache-on-release: setup-node step #3 must set package-manager-cache: false",
      ]);
    });

    test("S7: fails when a job lacks harden-runner", () => {
      const text = breakRelease(`${fixtureHardenStep}\n`, "");
      expect(findWorkflowProblems("release.yml", text)).toEqual([
        "release.yml:verify breaks harden-runner: the first step must be step-security/harden-runner",
      ]);
    });
  });

  test("CRLF line endings do not hide an unpinned reference", () => {
    const text = breakFixture(`actions/checkout@${sha} # v7.0.1`, "actions/checkout@v7").replaceAll(
      "\n",
      "\r\n",
    );
    expect(findWorkflowProblems("fixture.yml", text)).toEqual([
      "fixture.yml:build breaks pinned-actions: actions/checkout@v7 is not pinned to a 40-character SHA",
    ]);
  });
});

function readRepoWorkflows(): { name: string; text: string }[] {
  return readdirSync(workflowsDirectory)
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted()
    .map((name) => ({ name, text: readFileSync(join(workflowsDirectory, name), "utf8") }));
}

function listRepoStepCommands(): string[] {
  return readRepoWorkflows().flatMap(({ text }) => {
    const workflow: unknown = Bun.YAML.parse(text);
    const jobs = isRecord(workflow) && isRecord(workflow.jobs) ? Object.values(workflow.jobs) : [];
    return jobs.flatMap((job) => {
      const steps = isRecord(job) && Array.isArray(job.steps) ? (job.steps as unknown[]) : [];
      return steps.flatMap((step) =>
        isRecord(step) && typeof step.run === "string" ? listStepCommands(step.run) : [],
      );
    });
  });
}

describe("S5: CI steps call bun run <script>", () => {
  test("WHEN a step runs bunx commitlint directly THEN the rule fails naming the step", () => {
    const step = {
      name: "Validate commit messages",
      run: 'bunx commitlint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose',
    };
    expect(findStepScriptProblems("ci.yml", "commitlint", step, 5)).toEqual([
      'ci.yml:commitlint breaks steps-call-scripts: step "Validate commit messages" runs `bunx commitlint --from "$BASE_SHA" --to "$HEAD_SHA" --verbose` directly; call bun run <script>, or exempt the command with a reason',
    ]);
  });

  test("bun run <script> and a repo script under tools/ pass", () => {
    const step = {
      run: 'bun run lint:commits --from "$BASE_SHA" --to "$HEAD_SHA"\nbun run build:binary -- --target "$TARGET"\nbun tools/upgrade-job/main.ts',
    };
    expect(findStepScriptProblems("ci.yml", "check", step, 0)).toEqual([]);
  });

  test("a raw tool hidden in a command substitution fails", () => {
    const step = { name: "Resolve", run: 'version="$(npx semver 1.0.0)"\necho "$version"' };
    expect(findStepScriptProblems("release.yml", "verify", step, 0)).toEqual([
      'release.yml:verify breaks steps-call-scripts: step "Resolve" runs `npx semver 1.0.0` directly; call bun run <script>, or exempt the command with a reason',
    ]);
  });

  test.each([
    ["a plain command", 'bunx commitlint --from "$A"', ['bunx commitlint --from "$A"']],
    [
      "a command substitution in an assignment",
      'version="$(jq -r .version a.json)"',
      ["jq -r .version a.json"],
    ],
    [
      "an env prefix, a continuation and a substitution",
      'TARBALLS="$(printf \'%s,\' "$T"/*.tgz)" \\\n  bun test packages/x',
      ["bun test packages/x", "printf '%s,' \"$T\"/*.tgz"],
    ],
    [
      "a heredoc body",
      'cat >> "$F" <<NOTES\nsha256sum -c x\nbunx foo\nNOTES\necho done',
      ['cat >> "$F" <<NOTES', "echo done"],
    ],
    ["case patterns", 'case "$R" in success | skipped) ;; *) exit 1 ;; esac', ["exit 1"]],
    [
      "multi-line case patterns",
      'case "${v%%+*}" in\n  *-*) tag=next ;;\n  *) tag=latest ;;\nesac',
      [],
    ],
    ["array assignments", 'flags=(--repo "$R" --title x)\nflags+=(--prerelease)', []],
    [
      "a function the step defines",
      'publish() {\n  local name="$1"\n  npm publish "$name"\n}\npublish a',
      ['local name="$1"', 'npm publish "$name"'],
    ],
    [
      "if, negation and separators inside quotes",
      'if ! git merge-base --is-ancestor a b; then\n  echo "x (y); z | w"\nfi',
      ["git merge-base --is-ancestor a b", 'echo "x (y); z | w"'],
    ],
    ["a redirected group", '{\n  echo "a=b"\n} >> "$GITHUB_OUTPUT"', ['echo "a=b"']],
    [
      "a subshell",
      '(cd packages/aokit && bun pm pack --destination "$D")',
      ["cd packages/aokit", 'bun pm pack --destination "$D"'],
    ],
    ["a for loop", 'for p in a b; do\n  npm view "$p" || true\ndone', ['npm view "$p"', "true"]],
    ["a parameter expansion", 'workspace="${GITHUB_WORKSPACE//\\\\//}"', []],
    ["a comment", "# bunx commitlint\necho hi # bunx later", ["echo hi"]],
    ["a here-string", 'read -ra items <<< "$list"', ['read -ra items <<< "$list"']],
    ["a leading redirection", "2>/dev/null LC_ALL=C sort -k 2 > out", ["sort -k 2 > out"]],
    ["CRLF line endings", "echo a\r\nbunx foo\r\n", ["echo a", "bunx foo"]],
  ])("listStepCommands reads %s", (_label, run, expected) => {
    expect(listStepCommands(run)).toEqual(expected);
  });

  test("every exemption carries its own reason", () => {
    const reasons = stepsCallScriptsExemptions.map(({ reason }) => reason.trim());
    expect(reasons.filter((reason) => reason.length < 20)).toEqual([]);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  test("no exemption is blanket: none admits an unknown tool, bunx commitlint or bun x", () => {
    const outsiders = [
      "bunx commitlint --from a --to b",
      "bun x --no-install commitlint --edit x",
      "npx prettier --check .",
      "some-tool --flag",
      "",
    ];
    const admitted = stepsCallScriptsExemptions.flatMap(({ command }) =>
      outsiders.filter((outsider) => command.test(outsider)).map(String),
    );
    expect(admitted).toEqual([]);
  });

  test("every exemption is still used by a repo workflow step", () => {
    const commands = listRepoStepCommands();
    const unused = stepsCallScriptsExemptions
      .filter(({ command }) => !commands.some((text) => command.test(text)))
      .map(({ command }) => String(command));
    expect(unused).toEqual([]);
  });

  test("ci.yml validates commit messages with bun run lint:commits", () => {
    const ci: unknown = Bun.YAML.parse(readFileSync(join(workflowsDirectory, "ci.yml"), "utf8"));
    const jobs = isRecord(ci) && isRecord(ci.jobs) ? ci.jobs : {};
    const commitlint = isRecord(jobs.commitlint) ? jobs.commitlint : {};
    const steps = Array.isArray(commitlint.steps) ? (commitlint.steps as unknown[]) : [];
    const validate = steps.find(
      (step) => isRecord(step) && step.name === "Validate commit messages",
    );
    expect(isRecord(validate) ? validate.run : undefined).toBe(
      'bun run lint:commits --from "$BASE_SHA" --to "$HEAD_SHA"',
    );
  });

  test("the rule is repo-only, so a Module workflow may still call a raw tool", () => {
    expect(repoOnlyRules).toContain("steps-call-scripts");
  });
});

describe("github-ci Module workflow invariants", () => {
  test("every workflow the Module writes follows every rule except the repo-only ones", () => {
    const workflows = readModuleWorkflows();
    expect(workflows.map(({ name }) => name)).toEqual([
      "ci.yml",
      "codeql.yml",
      "labels.yml",
      "lint-docs.yml",
      "lint-pr.yml",
      "lint-workflows.yml",
      "scorecard.yml",
    ]);
    expect(workflows.flatMap(({ name, text }) => findModuleWorkflowProblems(name, text))).toEqual(
      [],
    );
  });

  test("a template that sets cancel-in-progress: true fails naming its file", () => {
    for (const { name, text } of readModuleWorkflows()) {
      const broken = text.replace(/cancel-in-progress: .*/, "cancel-in-progress: true");
      expect(broken).not.toBe(text);
      expect(findModuleWorkflowProblems(name, broken)).toEqual([
        `${name}:(workflow) breaks concurrency: cancel-in-progress is true, which cancels runs on main; use ${cancelOnPullRequestOnly}`,
      ]);
    }
  });

  test("scorecard.yml never cancels a run", () => {
    const scorecard: unknown = Bun.YAML.parse(
      readFileSync(join(moduleWorkflowsDirectory, "scorecard.yml"), "utf8"),
    );
    const concurrency = isRecord(scorecard) ? scorecard.concurrency : undefined;
    expect(isRecord(concurrency) ? concurrency["cancel-in-progress"] : undefined).toBe(false);
  });

  test("a push to main only is reported for the repo and not for the Module", () => {
    const text = readFileSync(join(moduleWorkflowsDirectory, "ci.yml"), "utf8");
    expect(findWorkflowProblems("ci.yml", text)).toContain(
      "ci.yml:(workflow) breaks push-branches: push.branches lists main without develop; a push to develop must run it too",
    );
    expect(findModuleWorkflowProblems("ci.yml", text)).toEqual([]);
  });

  test("push triggers stay on main", () => {
    const pushBranches = Object.fromEntries(
      readModuleWorkflows().flatMap(({ name, text }): [string, unknown[]][] => {
        const workflow: unknown = Bun.YAML.parse(text);
        const branches = isRecord(workflow) ? listPushBranches(workflow) : [];
        return branches.length === 0 ? [] : [[name, branches]];
      }),
    );
    expect(pushBranches).toEqual({
      "ci.yml": ["main"],
      "codeql.yml": ["main"],
      "labels.yml": ["main"],
      "lint-workflows.yml": ["main"],
      "scorecard.yml": ["main"],
    });
  });
});
