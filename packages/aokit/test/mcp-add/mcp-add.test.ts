import { z } from "zod";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  builtFixtureRegistry,
  editJson,
  removeTemporaryDirectories,
  serveRegistry,
  type ServedRegistry,
} from "../registry-remote/served-registry.ts";
import { callTool, createInput, entriesOf, planChangeCount } from "../mcp/helpers.ts";
import { addInput, committedProject, connectClient, git, newWorkspace } from "./helpers.ts";

const workspace = newWorkspace();

/** Creating a symlink on Windows needs a privilege CI runners lack. */
const symlinkTest = process.platform === "win32" ? test.skip : test;
const home = join(workspace, "home");

afterAll(async () => {
  rmSync(workspace, { recursive: true, force: true });
  await removeTemporaryDirectories();
});

let projectCount = 0;

async function freshProject(): Promise<string> {
  projectCount += 1;
  const directory = join(workspace, `project-${projectCount}`);
  await committedProject(directory);
  return directory;
}

describe("tool listing", () => {
  test("lists plan_add and add with explicit inputs and annotations", async () => {
    const client = await connectClient(home);
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("plan_add")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("add")?.annotations?.destructiveHint).toBe(true);
    const properties = Object.keys(byName.get("plan_add")?.inputSchema.properties ?? {}).toSorted();
    expect(properties).toEqual(["answer", "directory", "modules", "registry", "trust"]);
    expect([...(byName.get("plan_add")?.inputSchema.required ?? [])].toSorted()).toEqual(
      properties,
    );
    expect(byName.get("add")?.inputSchema.required).toContain("planId");
    for (const cliOnly of ["dryRun", "diff", "yes", "install", "allowDirty"]) {
      expect(Object.keys(byName.get("add")?.inputSchema.properties ?? {})).not.toContain(cliOnly);
    }
    for (const readOnly of ["get_schema", "get_guidance"]) {
      expect(byName.get(readOnly)?.annotations?.readOnlyHint).toBe(true);
    }
  });
});

describe("plan_add", () => {
  test("returns the add output, a planId and nextSteps and writes nothing", async () => {
    const directory = await freshProject();
    const before = readFileSync(join(directory, "aokit.lock.json"), "utf8");
    const client = await connectClient(home);
    const result = await callTool(client, "plan_add", addInput(directory));
    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);
    expect(result.data?.["planId"]).toEqual(expect.stringMatching(/^plan_[0-9a-f]{64}$/));
    expect(result.data?.["added"]).toEqual(["knip"]);
    expect(result.data?.["applied"]).toBe(false);
    expect(result.data?.["reproduce"]).toEqual(expect.any(String));
    expect(result.data?.["nextSteps"]).toEqual(expect.any(Array));
    expect(planChangeCount(result.data)).toBeGreaterThan(0);
    expect(readFileSync(join(directory, "aokit.lock.json"), "utf8")).toBe(before);
    expect(entriesOf(directory)).not.toContain("knip.json");
  });

  test("a relative directory is INVALID_INPUT whose fix asks for an absolute path", async () => {
    const client = await connectClient(home);
    const result = await callTool(client, "plan_add", addInput("relative-app"));
    expect(result.error?.code).toBe("INVALID_INPUT");
    expect(result.error?.fix).toContain("absolute");
  });

  test("a directory that is not a Project is LOCKFILE_MISSING", async () => {
    const client = await connectClient(home);
    const result = await callTool(client, "plan_add", addInput(workspace));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("LOCKFILE_MISSING");
  });
});

describe("add", () => {
  test("writes the Modules for a planned input and never installs", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const planned = await callTool(client, "plan_add", addInput(directory));
    const added = await callTool(client, "add", {
      ...addInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(added.error).toBeNull();
    expect(added.ok).toBe(true);
    expect(added.data?.["applied"]).toBe(true);
    expect(added.data?.["installed"]).toBe(false);
    expect(added.data?.["nextSteps"]).toContain("bun install");
    expect(readFileSync(join(directory, "aokit.lock.json"), "utf8")).toContain("knip");
    expect(entriesOf(directory)).not.toContain("node_modules");
  });

  test("a made-up planId fails with PLAN_REQUIRED and writes nothing", async () => {
    const directory = await freshProject();
    const before = readFileSync(join(directory, "aokit.lock.json"), "utf8");
    const result = await callTool(await connectClient(home), "add", {
      ...addInput(directory),
      planId: "plan_0",
    });
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(readFileSync(join(directory, "aokit.lock.json"), "utf8")).toBe(before);
  });

  test("a Lockfile that changed between plan_add and add is PLAN_REQUIRED", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const planned = await callTool(client, "plan_add", addInput(directory));
    const lockfilePath = join(directory, "aokit.lock.json");
    writeFileSync(lockfilePath, `${readFileSync(lockfilePath, "utf8")}\n`);
    const result = await callTool(client, "add", {
      ...addInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(directory)).not.toContain("knip.json");
  });

  test("a committed Lockfile change between plan_add and add is PLAN_REQUIRED", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const planned = await callTool(client, "plan_add", addInput(directory));
    const lockfilePath = join(directory, "aokit.lock.json");
    writeFileSync(lockfilePath, `${readFileSync(lockfilePath, "utf8")}\n`);
    await git(directory, "commit", "-q", "-am", "touch lockfile");
    const result = await callTool(client, "add", {
      ...addInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(result.error?.code).toBe("PLAN_REQUIRED");
  });

  test("a committed package.json change between plan_add and add is PLAN_REQUIRED", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const planned = await callTool(client, "plan_add", addInput(directory));
    const packagePath = join(directory, "package.json");
    const manifest = z.looseObject({}).parse(JSON.parse(readFileSync(packagePath, "utf8")));
    manifest["devDependencies"] = { left: "1.0.0" };
    writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
    await git(directory, "commit", "-q", "-am", "edit manifest");
    const before = readFileSync(packagePath, "utf8");
    const result = await callTool(client, "add", {
      ...addInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(readFileSync(packagePath, "utf8")).toBe(before);
  });

  test("a dirty git tree fails with DIRTY_TREE and writes nothing", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const planned = await callTool(client, "plan_add", addInput(directory));
    writeFileSync(join(directory, "notes.txt"), "uncommitted\n");
    const before = readFileSync(join(directory, "aokit.lock.json"), "utf8");
    const result = await callTool(client, "add", {
      ...addInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("DIRTY_TREE");
    expect(readFileSync(join(directory, "aokit.lock.json"), "utf8")).toBe(before);
  });

  test("plan_add on a dirty tree is DIRTY_TREE", async () => {
    const directory = await freshProject();
    writeFileSync(join(directory, "notes.txt"), "uncommitted\n");
    const result = await callTool(await connectClient(home), "plan_add", addInput(directory));
    expect(result.error?.code).toBe("DIRTY_TREE");
  });

  test("a planId reused for a second add is PLAN_REQUIRED", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const planned = await callTool(client, "plan_add", addInput(directory));
    const args = { ...addInput(directory), planId: planned.data?.["planId"] };
    expect((await callTool(client, "add", args)).ok).toBe(true);
    await git(directory, "add", "-A");
    await git(directory, "commit", "-q", "-m", "knip");
    const lockfile = readFileSync(join(directory, "aokit.lock.json"), "utf8");
    const second = await callTool(client, "add", args);
    expect(second.error?.code).toBe("PLAN_REQUIRED");
    expect(readFileSync(join(directory, "aokit.lock.json"), "utf8")).toBe(lockfile);
  });

  test("changed modules after plan_add are PLAN_REQUIRED", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const planned = await callTool(client, "plan_add", addInput(directory));
    const result = await callTool(client, "add", {
      ...addInput(directory, { modules: ["knip", "vitest"] }),
      planId: planned.data?.["planId"],
    });
    expect(result.error?.code).toBe("PLAN_REQUIRED");
  });

  test("a planId issued for plan is PLAN_REQUIRED for add", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const planned = await callTool(
      client,
      "plan",
      createInput(join(workspace, "elsewhere"), "oxc,vite-react"),
    );
    const result = await callTool(client, "add", {
      ...addInput(directory),
      planId: planned.data?.["planId"],
    });
    expect(result.error?.code).toBe("PLAN_REQUIRED");
    expect(entriesOf(directory)).not.toContain("knip.json");
  });

  test("two plans for different directories keep their own ids", async () => {
    const first = await freshProject();
    const second = await freshProject();
    const client = await connectClient(home);
    const firstPlan = await callTool(client, "plan_add", addInput(first));
    const secondPlan = await callTool(client, "plan_add", addInput(second));
    const crossed = await callTool(client, "add", {
      ...addInput(first),
      planId: secondPlan.data?.["planId"],
    });
    expect(crossed.error?.code).toBe("PLAN_REQUIRED");
    const applied = await callTool(client, "add", {
      ...addInput(second),
      planId: secondPlan.data?.["planId"],
    });
    expect(applied.ok).toBe(true);
    expect(firstPlan.data?.["planId"]).not.toBe(secondPlan.data?.["planId"]);
  });

  symlinkTest(
    "a directory with .. segments and a symlink names the canonical Project",
    async () => {
      const directory = await freshProject();
      const link = join(workspace, "project-link");
      symlinkSync(directory, link);
      const dotted = join(link, "..", basename(directory));
      const client = await connectClient(home);
      const planned = await callTool(client, "plan_add", addInput(dotted));
      expect(planned.error).toBeNull();
      expect(planned.data?.["directory"]).toBe(directory);
      const added = await callTool(client, "add", {
        ...addInput(directory),
        planId: planned.data?.["planId"],
      });
      expect(added.ok).toBe(true);
    },
  );
});

describe("untrusted Registry", () => {
  let served: ServedRegistry;

  beforeAll(async () => {
    const root = await builtFixtureRegistry();
    await editJson(join(root, "index.json"), (index) => {
      index["name"] = "acme";
    });
    served = serveRegistry(root);
  });

  afterAll(async () => {
    await served.stop();
  });

  test("trust null fails naming the trust field and writes nothing", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const result = await callTool(
      client,
      "plan_add",
      addInput(directory, { registry: served.url }),
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("REGISTRY_UNTRUSTED");
    expect(result.error?.fix).toContain("`trust` field");
    expect(result.error?.fix).not.toContain("--trust");
    expect(result.error?.message).not.toContain("--trust");
    expect(result.error?.message).toContain(served.url);
  });

  test("a matching trust entry plans and adds", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const args = addInput(directory, { registry: served.url, trust: [served.url] });
    const planned = await callTool(client, "plan_add", args);
    expect(planned.error).toBeNull();
    expect(planned.ok).toBe(true);
    const added = await callTool(client, "add", { ...args, planId: planned.data?.["planId"] });
    expect(added.error).toBeNull();
    expect(added.ok).toBe(true);
  });

  test("add without the trust entry fails even with a planId from a trusted plan", async () => {
    const directory = await freshProject();
    const client = await connectClient(home);
    const trusted = addInput(directory, { registry: served.url, trust: [served.url] });
    const planned = await callTool(client, "plan_add", trusted);
    const result = await callTool(client, "add", {
      ...addInput(directory, { registry: served.url }),
      planId: planned.data?.["planId"],
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PLAN_REQUIRED");
  });
});
