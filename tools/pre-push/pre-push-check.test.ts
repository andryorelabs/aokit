import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PRE_PUSH_GATES, checkPushLine, pushNeedsGates, runGates } from "./pre-push-check.ts";

const sha = "1111111111111111111111111111111111111111";
const zero = "0000000000000000000000000000000000000000";

function push(branch: string): string {
  return `refs/heads/local ${sha} refs/heads/${branch} ${zero}`;
}

describe("checkPushLine", () => {
  test.each(["feat/x", "ao-12-fix-thing", "renovate/foo", "fix/some-long-slug-2", "renovate/a/b"])(
    "passes %s",
    (branch) => {
      expect(checkPushLine(push(branch))).toEqual({ ok: true });
    },
  );

  test("refuses main with a one-line reason", () => {
    const verdict = checkPushLine(push("main"));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("main");
      expect(verdict.reason).not.toContain("\n");
    }
  });

  test.each(["Bad_Name", "feat/Bad", "feature/x", "ao-x", "ao-12", "develop", "feat/"])(
    "refuses %s",
    (branch) => {
      const verdict = checkPushLine(push(branch));
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).not.toContain("\n");
      }
    },
  );

  test("skips tag pushes", () => {
    expect(checkPushLine(`refs/tags/v1 ${sha} refs/tags/Bad_Tag ${zero}`)).toEqual({ ok: true });
  });

  test("skips branch deletions, including main", () => {
    expect(checkPushLine(`(delete) ${zero} refs/heads/Bad_Name ${sha}`)).toEqual({ ok: true });
    expect(checkPushLine(`(delete) ${zero} refs/heads/main ${sha}`)).toEqual({ ok: true });
  });

  test("skips malformed lines", () => {
    expect(checkPushLine("")).toEqual({ ok: true });
  });
});

describe("pushNeedsGates", () => {
  test("is true for a branch update", () => {
    expect(pushNeedsGates([push("feat/x")])).toBe(true);
  });

  test("is false for deletions, tags and no lines", () => {
    expect(pushNeedsGates([`(delete) ${zero} refs/heads/feat/x ${sha}`])).toBe(false);
    expect(pushNeedsGates([`refs/tags/v1 ${sha} refs/tags/v1 ${zero}`])).toBe(false);
    expect(pushNeedsGates([])).toBe(false);
  });

  test("is true for a mixed push of a deletion and a branch update", () => {
    expect(pushNeedsGates([`(delete) ${zero} refs/heads/feat/old ${sha}`, push("feat/x")])).toBe(
      true,
    );
  });
});

describe("runGates", () => {
  test("defines typecheck then format:check", () => {
    expect(PRE_PUSH_GATES).toEqual([
      ["bun", "run", "typecheck"],
      ["bun", "run", "format:check"],
    ]);
  });

  test("runs every gate in order and returns 0 when all pass", () => {
    const ran: string[] = [];
    const code = runGates((command) => {
      ran.push(command.join(" "));
      return 0;
    });
    expect(code).toBe(0);
    expect(ran).toEqual(["bun run typecheck", "bun run format:check"]);
  });

  test("stops at the first failure and returns its exit code", () => {
    const ran: string[] = [];
    const code = runGates((command) => {
      ran.push(command.join(" "));
      return 2;
    });
    expect(code).toBe(2);
    expect(ran).toEqual(["bun run typecheck"]);
  });

  test("returns the exit code of a later failing gate", () => {
    const code = runGates((command) => (command[2] === "format:check" ? 3 : 0));
    expect(code).toBe(3);
  });

  test("accepts custom gates", () => {
    expect(runGates(() => 0, [])).toBe(0);
  });
});

async function runScript(stdin: string): Promise<{ code: number; stderr: string }> {
  const scriptProcess = Bun.spawn(["bun", join(import.meta.dir, "main.ts")], {
    stdin: new Blob([stdin]),
    stderr: "pipe",
  });
  const stderr = await new Response(scriptProcess.stderr).text();
  return { code: await scriptProcess.exited, stderr };
}

describe("script process", () => {
  test("exits 0 without gates for a tag push", async () => {
    expect((await runScript(`refs/tags/v1 ${sha} refs/tags/v1 ${zero}\n`)).code).toBe(0);
  });

  test("exits non-zero with one reason line for main", async () => {
    const result = await runScript(`${push("main")}\n`);
    expect(result.code).not.toBe(0);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
  });

  test("exits non-zero for Bad_Name", async () => {
    expect((await runScript(`${push("Bad_Name")}\n`)).code).not.toBe(0);
  });
});
