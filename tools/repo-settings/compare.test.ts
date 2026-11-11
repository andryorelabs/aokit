import { describe, expect, test } from "bun:test";
import { compareSettings } from "./compare.ts";

describe("compareSettings", () => {
  test("equal values report no drift", () => {
    const settings = { repository: { allow_squash_merge: true, topics: ["bun", "cli"] } };
    expect(compareSettings(settings, structuredClone(settings))).toEqual([]);
  });

  test("a differing value reports the setting path, the expected value and the live value", () => {
    expect(
      compareSettings(
        { repository: { allow_auto_merge: true, has_wiki: false } },
        { repository: { allow_auto_merge: false, has_wiki: false } },
      ),
    ).toEqual([{ setting: "repository.allow_auto_merge", expected: true, live: false }]);
  });

  test("a live key the expected settings do not name is ignored", () => {
    expect(
      compareSettings(
        { repository: { has_wiki: false } },
        { repository: { has_wiki: false, id: 7 } },
      ),
    ).toEqual([]);
  });

  test("a setting missing from the live value is drift with live undefined", () => {
    expect(compareSettings({ security: { secret_scanning: true } }, { security: {} })).toEqual([
      { setting: "security.secret_scanning", expected: true, live: undefined },
    ]);
  });

  test("a list element that differs is named by its index", () => {
    expect(compareSettings({ include: ["~ALL", "a"] }, { include: ["~ALL", "b"] })).toEqual([
      { setting: "include[1]", expected: "a", live: "b" },
    ]);
  });

  test("lists of different length are drift as a whole, so an extra live entry is reported", () => {
    expect(compareSettings({ bypass_actors: [] }, { bypass_actors: [{ actor_id: 5 }] })).toEqual([
      { setting: "bypass_actors", expected: [], live: [{ actor_id: 5 }] },
    ]);
  });

  test("a mapping compared with a value of another kind is drift as a whole", () => {
    expect(compareSettings({ security: { secret_scanning: true } }, { security: null })).toEqual([
      { setting: "security", expected: { secret_scanning: true }, live: null },
    ]);
    expect(compareSettings({ topics: ["bun"] }, { topics: "bun" })).toEqual([
      { setting: "topics", expected: ["bun"], live: "bun" },
    ]);
  });

  test("a difference at the top level is named (root)", () => {
    expect(compareSettings("PR_TITLE", "COMMIT_OR_PR_TITLE")).toEqual([
      { setting: "(root)", expected: "PR_TITLE", live: "COMMIT_OR_PR_TITLE" },
    ]);
  });
});
