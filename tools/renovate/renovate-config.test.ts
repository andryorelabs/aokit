import { describe, expect, test } from "bun:test";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

const renovateConfigPath = join(import.meta.dir, "..", "..", "renovate.json5");
const oxcMembers = ["oxlint", "oxfmt", "oxlint-tsgolint", "@oxlint/plugins", "oxc-parser"];

/**
 * Narrows an unknown value to a plain object.
 */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows an unknown value to an array of strings.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Parses `renovate.json5` with the JSON5 parser built into Bun.
 */
async function loadRenovateConfig(): Promise<JsonObject> {
  const parsed: unknown = Bun.JSON5.parse(await Bun.file(renovateConfigPath).text());
  if (!isJsonObject(parsed)) {
    throw new Error("renovate.json5 must contain an object");
  }
  return parsed;
}

/**
 * Returns the `packageRules` entries of a Renovate config.
 */
function packageRulesOf(config: JsonObject): JsonObject[] {
  const rules = config["packageRules"];
  if (!Array.isArray(rules)) {
    throw new Error("packageRules must be an array");
  }
  return rules.filter(isJsonObject);
}

/**
 * Finds the package rule whose `groupName` matches.
 */
function groupRuleOf(config: JsonObject, groupName: string): JsonObject {
  const rule = packageRulesOf(config).find((candidate) => candidate["groupName"] === groupName);
  if (rule === undefined) {
    throw new Error(`missing package rule group ${groupName}`);
  }
  return rule;
}

/**
 * Finds the automerging package rule that selects the given value.
 */
function automergeRuleOf(
  config: JsonObject,
  selectorKey: string,
  selectorValue: string,
): JsonObject {
  const rule = packageRulesOf(config).find((candidate) => {
    const selector = candidate[selectorKey];
    return (
      isStringArray(selector) && selector.includes(selectorValue) && candidate["automerge"] === true
    );
  });
  if (rule === undefined) {
    throw new Error(`missing automerge rule for ${selectorKey}=${selectorValue}`);
  }
  return rule;
}

/**
 * Returns the two patch and minor automerge rules (devDependencies, actions).
 */
function automergeRulesOf(config: JsonObject): JsonObject[] {
  return [
    automergeRuleOf(config, "matchDepTypes", "devDependencies"),
    automergeRuleOf(config, "matchManagers", "github-actions"),
  ];
}

describe("renovate.json5", () => {
  test("extends config:best-practices", async () => {
    const config = await loadRenovateConfig();
    expect(config["extends"]).toContain("config:best-practices");
  });

  test("waits 3 days by default and 7 days for automerge", async () => {
    const config = await loadRenovateConfig();
    expect(config["minimumReleaseAge"]).toBe("3 days");
    for (const rule of automergeRulesOf(config)) {
      expect(rule["minimumReleaseAge"]).toBe("7 days");
    }
  });

  test("automerges patch and minor devDependency and action updates", async () => {
    const config = await loadRenovateConfig();
    for (const rule of automergeRulesOf(config)) {
      expect(rule["matchUpdateTypes"]).toEqual(["patch", "minor"]);
    }
  });

  test("pins the oxc group exactly and never automerges it", async () => {
    const group = groupRuleOf(await loadRenovateConfig(), "oxc");
    expect(group["matchPackageNames"]).toEqual(oxcMembers);
    expect(group["rangeStrategy"]).toBe("pin");
    expect(group["automerge"]).toBe(false);
  });

  test("pins the typescript7 group exactly and never automerges it", async () => {
    const group = groupRuleOf(await loadRenovateConfig(), "typescript7");
    expect(group["matchDepNames"]).toEqual(["typescript7"]);
    expect(group["rangeStrategy"]).toBe("pin");
    expect(group["automerge"]).toBe(false);
  });

  test("limits typescript to versions below 7", async () => {
    const rule = packageRulesOf(await loadRenovateConfig()).find((candidate) => {
      const names = candidate["matchDepNames"];
      return isStringArray(names) && names.includes("typescript");
    });
    expect(rule?.["allowedVersions"]).toBe("<7");
  });

  test("enables OSV vulnerability alerts", async () => {
    const config = await loadRenovateConfig();
    expect(config["osvVulnerabilityAlerts"]).toBe(true);
  });

  test("enables lockfile maintenance", async () => {
    const config = await loadRenovateConfig();
    const maintenance = config["lockFileMaintenance"];
    expect(isJsonObject(maintenance) && maintenance["enabled"]).toBe(true);
  });

  test("runs on Mondays", async () => {
    const config = await loadRenovateConfig();
    const schedule = config["schedule"];
    expect(isStringArray(schedule) && schedule.join(" ")).toContain("on monday");
  });

  test("enables the dependency dashboard", async () => {
    const config = await loadRenovateConfig();
    expect(config["dependencyDashboard"]).toBe(true);
  });

  test("labels updates and each label exists in labels.yml", async () => {
    const config = await loadRenovateConfig();
    const declared: unknown = Bun.YAML.parse(
      await Bun.file(join(import.meta.dir, "..", "..", ".github", "labels.yml")).text(),
    );
    const declaredNames = Array.isArray(declared)
      ? declared.map((label: unknown) => (isJsonObject(label) ? label["name"] : undefined))
      : [];
    const referenced = [
      ...(isStringArray(config["labels"]) ? config["labels"] : []),
      ...packageRulesOf(config).flatMap((rule) =>
        isStringArray(rule["addLabels"]) ? rule["addLabels"] : [],
      ),
    ];
    expect(referenced).toContain("dependencies");
    expect(referenced).toContain("github-actions");
    expect(referenced.filter((label) => !declaredNames.includes(label))).toEqual([]);
  });

  test("has a regex manager for renovate datasource comments", async () => {
    const config = await loadRenovateConfig();
    const managers = config["customManagers"];
    const manager = Array.isArray(managers) ? managers.find(isJsonObject) : undefined;
    expect(manager?.["customType"]).toBe("regex");
    const matchStrings = manager?.["matchStrings"];
    if (!isStringArray(matchStrings)) {
      throw new Error("regex manager needs matchStrings");
    }
    const pattern = new RegExp(matchStrings[0] ?? "");
    const match = pattern.exec(
      "# renovate: datasource=npm depName=oxlint\n  OXLINT_VERSION: 1.90.0\n",
    );
    expect(match?.groups).toMatchObject({
      datasource: "npm",
      depName: "oxlint",
      currentValue: "1.90.0",
    });
  });
});
