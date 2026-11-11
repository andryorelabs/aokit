import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareSettings, isRecord, type Drift } from "./compare.ts";

/** The outcome of one `gh` invocation. */
export type GhResult = { exitCode: number; stdout: string; stderr: string };

/** Runs `gh` with the given arguments. Tests inject one that answers from memory. */
export type GhRunner = (args: readonly string[]) => GhResult;

/** The live settings could not be read, so no comparison was made. */
class LiveSettingsError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** The most rulesets GitHub returns in one page. */
const RULESETS_PAGE_SIZE = 100;

/**
 * Returns a runner that spawns `command`. A command that cannot be started throws a
 * `LiveSettingsError` that says to install the GitHub CLI, and one that runs longer than
 * `timeoutMs` is stopped and throws a `LiveSettingsError` too.
 */
export function createGhRunner(command = "gh", timeoutMs = DEFAULT_TIMEOUT_MS): GhRunner {
  return (args) => {
    try {
      const result = Bun.spawnSync([command, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs,
      });
      if (result.exitedDueToTimeout === true) {
        throw new LiveSettingsError(
          `${command} ${args.join(" ")} did not finish within ${timeoutMs} ms. Check the network and run the check again.`,
        );
      }
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      };
    } catch (error) {
      if (error instanceof LiveSettingsError) throw error;
      throw new LiveSettingsError(
        `could not run ${command}. Install the GitHub CLI (https://cli.github.com) and put it on PATH. (${errorMessage(error)})`,
        { cause: error },
      );
    }
  };
}

/** Sends one GET request through `gh api`. The check has no other way to reach GitHub. */
function requestGet(runGh: GhRunner, endpoint: string): GhResult {
  return runGh(["api", "--method", "GET", endpoint]);
}

function failedRequest(endpoint: string, result: GhResult): LiveSettingsError {
  return new LiveSettingsError(
    `gh api ${endpoint} failed with exit code ${result.exitCode}: ${result.stderr.trim()}. Run \`gh auth status\` to check that gh is installed and authenticated.`,
  );
}

function getJson(runGh: GhRunner, endpoint: string): unknown {
  const result = requestGet(runGh, endpoint);
  if (result.exitCode !== 0) throw failedRequest(endpoint, result);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new LiveSettingsError(`gh api ${endpoint} did not return JSON.`, { cause: error });
  }
}

/** Dependabot alerts answer 204 when on and 404 when off; any other failure is an error. */
function readDependabotAlerts(runGh: GhRunner, repository: string): boolean {
  const endpoint = `repos/${repository}/vulnerability-alerts`;
  const result = requestGet(runGh, endpoint);
  if (result.exitCode === 0) return true;
  if (result.stderr.includes("HTTP 404")) return false;
  throw failedRequest(endpoint, result);
}

function readStatus(securityAndAnalysis: unknown, feature: string): boolean | undefined {
  const entry = isRecord(securityAndAnalysis) ? securityAndAnalysis[feature] : undefined;
  const status = isRecord(entry) ? entry["status"] : undefined;
  if (status === "enabled") return true;
  return status === "disabled" ? false : undefined;
}

function sortStrings(value: unknown): unknown {
  return Array.isArray(value) ? value.map(String).toSorted() : value;
}

/** Topics have no order on GitHub, so both sides are sorted before they are compared. */
function withSortedTopics(repositorySettings: unknown): unknown {
  if (!isRecord(repositorySettings)) return repositorySettings;
  return { ...repositorySettings, topics: sortStrings(repositorySettings["topics"]) };
}

/** Reads the live counterpart of `.github/settings.json`, in the shape of that file. */
function readLiveSettings(runGh: GhRunner, repository: string): unknown {
  const repositoryResponse = getJson(runGh, `repos/${repository}`);
  const securityAndAnalysis = isRecord(repositoryResponse)
    ? repositoryResponse["security_and_analysis"]
    : undefined;
  const dependabotAlerts = readDependabotAlerts(runGh, repository);
  const privateReporting = getJson(runGh, `repos/${repository}/private-vulnerability-reporting`);
  return {
    repository: withSortedTopics(repositoryResponse),
    security: {
      secret_scanning: readStatus(securityAndAnalysis, "secret_scanning"),
      secret_scanning_push_protection: readStatus(
        securityAndAnalysis,
        "secret_scanning_push_protection",
      ),
      dependabot_alerts: dependabotAlerts,
      dependabot_security_updates: readStatus(securityAndAnalysis, "dependabot_security_updates"),
      private_vulnerability_reporting: isRecord(privateReporting)
        ? privateReporting["enabled"]
        : undefined,
    },
  };
}

function compareContexts(left: unknown, right: unknown): number {
  const leftContext = isRecord(left) ? String(left["context"]) : "";
  const rightContext = isRecord(right) ? String(right["context"]) : "";
  return leftContext.localeCompare(rightContext);
}

function normalizeParameters(parameters: unknown): unknown {
  if (!isRecord(parameters)) return {};
  const checks = parameters["required_status_checks"];
  if (!Array.isArray(checks)) return parameters;
  return { ...parameters, required_status_checks: checks.toSorted(compareContexts) };
}

/**
 * Rewrites a ruleset so it compares by meaning: `rules` becomes a mapping from rule type to its
 * parameters and required checks are sorted by name, since GitHub returns both in its own order.
 */
function normalizeRuleset(ruleset: unknown): Record<string, unknown> {
  const source = isRecord(ruleset) ? ruleset : {};
  const rules = Array.isArray(source["rules"]) ? source["rules"].filter(isRecord) : [];
  return {
    ...source,
    rules: Object.fromEntries(
      rules.map((rule) => [String(rule["type"]), normalizeParameters(rule["parameters"])]),
    ),
  };
}

function compareRuleset(expectedRuleset: unknown, liveRuleset: unknown): Drift[] {
  const expected = normalizeRuleset(expectedRuleset);
  const live = normalizeRuleset(liveRuleset);
  const expectedRules = isRecord(expected["rules"]) ? expected["rules"] : {};
  const liveRules = isRecord(live["rules"]) ? live["rules"] : {};
  const liveOnly = Object.entries(liveRules)
    .filter(([type]) => !(type in expectedRules))
    .map(([type, parameters]) => ({
      setting: `rules.${type}`,
      expected: undefined,
      live: parameters,
    }));
  return compareSettings(expected, live).concat(liveOnly);
}

function prefixed(prefix: string, drift: Drift): Drift {
  const setting = drift.setting === "(root)" ? prefix : `${prefix} ${drift.setting}`;
  return { ...drift, setting };
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readExpectedSettings(repoRoot: string): unknown {
  const settings = readJsonFile(join(repoRoot, ".github", "settings.json"));
  if (!isRecord(settings)) return settings;
  return { ...settings, repository: withSortedTopics(settings["repository"]) };
}

function listRulesetFiles(repoRoot: string): string[] {
  return readdirSync(join(repoRoot, ".github", "rulesets"))
    .filter((file) => file.endsWith(".json"))
    .toSorted();
}

function findRulesetDrift(
  runGh: GhRunner,
  repository: string,
  repoRoot: string,
  files: readonly string[],
): Drift[] {
  const liveRulesets = getJson(
    runGh,
    `repos/${repository}/rulesets?per_page=${RULESETS_PAGE_SIZE}`,
  );
  const liveList = Array.isArray(liveRulesets) ? liveRulesets.filter(isRecord) : [];
  if (liveList.length >= RULESETS_PAGE_SIZE) {
    throw new LiveSettingsError(
      `${repository} has ${RULESETS_PAGE_SIZE} or more rulesets, so the list may be incomplete.`,
    );
  }
  return files.flatMap((file) => {
    const expected = readJsonFile(join(repoRoot, ".github", "rulesets", file));
    const name = isRecord(expected) ? expected["name"] : undefined;
    const summary = liveList.find((ruleset) => ruleset["name"] === name);
    const prefix = `rulesets/${file}`;
    if (summary === undefined) {
      return [
        { setting: prefix, expected: `a live ruleset named ${String(name)}`, live: undefined },
      ];
    }
    const live = getJson(runGh, `repos/${repository}/rulesets/${String(summary["id"])}`);
    return compareRuleset(expected, live).map((drift) => prefixed(prefix, drift));
  });
}

function formatValue(value: unknown): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function formatDrift(drift: Drift): string[] {
  return [
    `Drift: ${drift.setting}`,
    `  expected: ${formatValue(drift.expected)}`,
    `  live:     ${formatValue(drift.live)}`,
  ];
}

/** What `runCheck` needs: where the files are, which repository to read and how to reach it. */
export type CheckOptions = {
  repoRoot: string;
  repository: string;
  runGh: GhRunner;
  print: (line: string) => void;
};

/**
 * Compares `.github/settings.json` and every `.github/rulesets/*.json` with the live repository
 * through `gh api` GET requests, and never writes. Returns 0 when they match. Returns 1 after
 * printing each drifted setting with its expected and live value, or after printing why the live
 * settings could not be read (gh missing, unauthenticated or a failed request).
 */
export function runCheck({ repoRoot, repository, runGh, print }: CheckOptions): number {
  const rulesetFiles = listRulesetFiles(repoRoot);
  let drifts: Drift[];
  try {
    const settingsDrift = compareSettings(
      readExpectedSettings(repoRoot),
      readLiveSettings(runGh, repository),
    ).map((drift) => prefixed("settings.json", drift));
    drifts = settingsDrift.concat(findRulesetDrift(runGh, repository, repoRoot, rulesetFiles));
  } catch (error) {
    if (!(error instanceof LiveSettingsError)) throw error;
    print(`repo-settings:check could not read the live settings: ${error.message}`);
    return 1;
  }
  if (drifts.length === 0) {
    print(
      `Live settings of ${repository} match .github/settings.json and .github/rulesets (${rulesetFiles.join(", ")}).`,
    );
    return 0;
  }
  for (const drift of drifts) formatDrift(drift).forEach(print);
  const summary = drifts.length === 1 ? "1 live setting" : `${drifts.length} live settings`;
  print(
    `${summary} of ${repository} ${drifts.length === 1 ? "differs" : "differ"} from the files.`,
  );
  return 1;
}
