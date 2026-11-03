import { expect, test } from "bun:test";
import { createArguments, createSucceeded, imageTag, pickDockerfile } from "./main.ts";

test("create arguments select oxc,hono,docker non-interactively", () => {
  const args = createArguments("monorepo", "/tmp/p");
  expect(args).toContain("oxc,hono,docker");
  expect(args).toContain("--yes");
  expect(args).toContain("--json");
  expect(args[args.indexOf("--layout") + 1]).toBe("monorepo");
});

test("pickDockerfile prefers the shallowest Dockerfile", () => {
  expect(pickDockerfile(["apps/server/Dockerfile", "Dockerfile", "a.ts"])).toBe("Dockerfile");
  expect(pickDockerfile(["apps/server/Dockerfile", "apps/a/b/Dockerfile"])).toBe(
    "apps/server/Dockerfile",
  );
  expect(pickDockerfile(["a.ts"])).toBeUndefined();
});

test("createSucceeded reads the JSON envelope", () => {
  expect(createSucceeded('{"ok":true}')).toBe(true);
  expect(createSucceeded('{"ok":false}')).toBe(false);
  expect(createSucceeded("nope")).toBe(false);
});

test("image tags differ per layout", () => {
  expect(imageTag("single")).not.toBe(imageTag("monorepo"));
});
