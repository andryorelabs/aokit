import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkPushLine } from "./pre-push-check.ts";

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

async function runScript(stdin: string): Promise<{ code: number; stderr: string }> {
  const scriptProcess = Bun.spawn(["bun", join(import.meta.dir, "main.ts")], {
    stdin: new Blob([stdin]),
    stderr: "pipe",
  });
  const stderr = await new Response(scriptProcess.stderr).text();
  return { code: await scriptProcess.exited, stderr };
}

describe("script process", () => {
  test("exits 0 for a valid branch", async () => {
    expect((await runScript(`${push("feat/x")}\n`)).code).toBe(0);
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
