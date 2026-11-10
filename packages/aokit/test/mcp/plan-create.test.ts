import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  callTool,
  conflictingRegistry,
  connectClient,
  createInput,
  entriesOf,
  newWorkspace,
  planChangeCount,
  releasedRegistry,
} from "./helpers.ts";

const workspace = newWorkspace();

/** Creating a symlink on Windows needs a privilege CI runners lack. */
const symlinkTest = process.platform === "win32" ? test.skip : test;

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("tool listing", () => {
  test("lists plan and create with explicit inputs and annotations", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const plan = byName.get("plan");
    const create = byName.get("create");
    expect(plan?.annotations?.readOnlyHint).toBe(true);
    expect(create?.annotations?.destructiveHint).toBe(true);
    const planProperties = Object.keys(plan?.inputSchema.properties ?? {}).toSorted();
    expect(planProperties).toEqual(
      ["answer", "directory", "from", "layout", "modules", "registry", "trust"].toSorted(),
    );
    expect([...(plan?.inputSchema.required ?? [])].toSorted()).toEqual(planProperties);
    expect(create?.inputSchema.required).toContain("planId");
    for (const cliOnly of ["dryRun", "diff", "yes", "install", "allowDirty"]) {
      expect(Object.keys(create?.inputSchema.properties ?? {})).not.toContain(cliOnly);
    }
  });
});

describe("plan", () => {
  test("returns the Plan, a planId and nextSteps without creating the directory", async () => {
    const client = await connectClient();
    const directory = join(workspace, "planned");
    const result = await callTool(client, "plan", createInput(directory));
    expect(result.ok).toBe(true);
    expect(result.isError).toBe(false);
    expect(result.data?.["planId"]).toEqual(expect.stringMatching(/^plan_[0-9a-f]{64}$/));
    expect(result.data?.["reproduce"]).toEqual(expect.any(String));
    expect(result.data?.["applied"]).toBe(false);
    expect(planChangeCount(result.data)).toBeGreaterThan(0);
    expect(result.data?.["nextSteps"]).toEqual(expect.any(Array));
    expect(entriesOf(workspace)).not.toContain("planned");
  });

  test("two conflicting Modules fail as a result with CAPABILITY_CONFLICT and a fix", async () => {
    const registry = await conflictingRegistry(workspace);
    const client = await connectClient();
    const result = await callTool(client, "plan", {
      ...createInput(join(workspace, "conflict"), "oxc,eslint"),
      registry,
    });
    expect(result.ok).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("CAPABILITY_CONFLICT");
    expect(result.error?.fix).not.toBe("");
  });

  test("a relative directory is INVALID_INPUT whose fix asks for an absolute path", async () => {
    const client = await connectClient();
    const result = await callTool(client, "plan", createInput("relative-app"));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.fix).toContain("absolute");
  });
});

describe("create", () => {
  test("writes the Project for a planned input and returns bun install as a next step", async () => {
    const client = await connectClient();
    const directory = join(workspace, "created");
    const planned = await callTool(client, "plan", createInput(directory));
    const created = await callTool(client, "create", {
      ...createInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(created.error).toBeNull();
    expect(created.ok).toBe(true);
    expect(created.data?.["applied"]).toBe(true);
    expect(created.data?.["installed"]).toBe(false);
    expect(created.data?.["nextSteps"]).toContain("bun install");
    expect(entriesOf(directory)).toContain("aokit.lock.json");
    expect(entriesOf(directory)).not.toContain("node_modules");
  });

  test("a made-up planId fails with PLAN_REQUIRED and writes nothing", async () => {
    const client = await connectClient();
    const directory = join(workspace, "made-up");
    const result = await callTool(client, "create", {
      ...createInput(directory),
      planId: "plan_0",
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(workspace)).not.toContain("made-up");
  });

  test("changed modules after plan fail with PLAN_REQUIRED and write nothing", async () => {
    const client = await connectClient();
    const directory = join(workspace, "changed");
    const planned = await callTool(client, "plan", createInput(directory));
    const result = await callTool(client, "create", {
      ...createInput(directory, "oxc,vite-react,knip"),
      planId: planned.data?.["planId"],
    });
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(workspace)).not.toContain("changed");
  });

  test("a planId from another server session is PLAN_REQUIRED", async () => {
    const directory = join(workspace, "restarted");
    const planned = await callTool(await connectClient(), "plan", createInput(directory));
    const result = await callTool(await connectClient(), "create", {
      ...createInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(workspace)).not.toContain("restarted");
  });

  test("a planId replayed after the target changed on disk writes nothing", async () => {
    const client = await connectClient();
    const directory = join(workspace, "replayed");
    const planned = await callTool(client, "plan", createInput(directory));
    mkdirSync(directory);
    writeFileSync(join(directory, "notes.txt"), "mine\n");
    const result = await callTool(client, "create", {
      ...createInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(directory)).toEqual(["notes.txt"]);
  });

  test("a planId reused for a second create into the same directory writes nothing", async () => {
    const client = await connectClient();
    const directory = join(workspace, "twice");
    const planned = await callTool(client, "plan", createInput(directory));
    const args = { ...createInput(directory), planId: planned.data?.["planId"] };
    expect((await callTool(client, "create", args)).ok).toBe(true);
    const lockfile = readFileSync(join(directory, "aokit.lock.json"), "utf8");
    const second = await callTool(client, "create", args);
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe("PLAN_REQUIRED");
    expect(readFileSync(join(directory, "aokit.lock.json"), "utf8")).toBe(lockfile);
  });

  test("two plans for different directories in one session keep their own ids", async () => {
    const client = await connectClient();
    const first = join(workspace, "first");
    const second = join(workspace, "second");
    const firstPlan = await callTool(client, "plan", createInput(first));
    const secondPlan = await callTool(client, "plan", createInput(second));
    expect(firstPlan.data?.["planId"]).not.toBe(secondPlan.data?.["planId"]);
    const crossed = await callTool(client, "create", {
      ...createInput(first),
      planId: secondPlan.data?.["planId"],
    });
    expect(crossed.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(workspace)).not.toContain("first");
    const created = await callTool(client, "create", {
      ...createInput(second),
      planId: secondPlan.data?.["planId"],
    });
    expect(created.ok).toBe(true);
  });

  test("a directory with .. segments plans and creates the normalized directory", async () => {
    const client = await connectClient();
    const target = join(workspace, "dotted");
    const dotted = join(workspace, "elsewhere", "..", "dotted");
    const planned = await callTool(client, "plan", createInput(dotted));
    expect(planned.data?.["directory"]).toBe(target);
    const created = await callTool(client, "create", {
      ...createInput(target),
      planId: planned.data?.["planId"],
    });
    expect(created.ok).toBe(true);
    expect(entriesOf(target)).toContain("aokit.lock.json");
    expect(entriesOf(workspace)).not.toContain("elsewhere");
  });

  symlinkTest("a symlink moved between plan and create is PLAN_REQUIRED", async () => {
    const client = await connectClient();
    const one = join(workspace, "link-one");
    const two = join(workspace, "link-two");
    mkdirSync(one);
    mkdirSync(two);
    const link = join(workspace, "link");
    symlinkSync(one, link);
    const directory = join(link, "app");
    const planned = await callTool(client, "plan", createInput(directory));
    expect(planned.data?.["directory"]).toBe(join(one, "app"));
    rmSync(link);
    symlinkSync(two, link);
    const result = await callTool(client, "create", {
      ...createInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(one)).toEqual([]);
    expect(entriesOf(two)).toEqual([]);
  });
});

describe("call queue", () => {
  test("two concurrent creates into one directory run one after the other", async () => {
    const client = await connectClient();
    const directory = join(workspace, "queued");
    const planned = await callTool(client, "plan", createInput(directory));
    const planId = String(planned.data?.["planId"]);
    const createArguments = { ...createInput(directory), planId };
    const [first, second] = await Promise.all([
      callTool(client, "create", createArguments),
      callTool(client, "create", createArguments),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(directory)).toContain("aokit.lock.json");
  }, 60_000);
});

describe("invalid tool input", () => {
  test("a missing field is an INVALID_INPUT result with a fix, not a protocol error", async () => {
    const client = await connectClient();
    const result = await callTool(client, "plan", { directory: join(workspace, "partial") });
    expect(result.ok).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.fix).toContain("null");
    expect(entriesOf(workspace)).not.toContain("partial");
  });
});

describe("planId and the Release", () => {
  test("the same input against another Release yields another planId", async () => {
    const first = await releasedRegistry(workspace, "2026.11.0");
    const second = await releasedRegistry(workspace, "2026.12.0");
    const client = await connectClient();
    const directory = join(workspace, "released");
    const planOn = (registry: string) =>
      callTool(client, "plan", { ...createInput(directory, "oxc"), registry });
    const onFirst = await planOn(first);
    const onSecond = await planOn(second);
    expect(onFirst.error).toBeNull();
    expect(onSecond.error).toBeNull();
    expect(onFirst.data?.["release"]).not.toBe(onSecond.data?.["release"]);
    expect(onFirst.data?.["planId"]).not.toBe(onSecond.data?.["planId"]);
  });
});
