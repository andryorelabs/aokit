import { expect, test } from "bun:test";
import { reproduceCommand } from "../../src/project/reproduce.ts";

test("reproduceCommand sorts modules and answers and quotes unsafe values", () => {
  const command = reproduceCommand({
    directory: "my app",
    layout: "single",
    modules: ["vitest", "bun"],
    answers: { vitest: { b: "it's", a: 1 }, bun: { name: "x" } },
    registry: "https://example.com/r",
    install: false,
  });
  expect(command).toBe(
    "aokit create 'my app' --layout single --modules bun,vitest --answer bun.name=x --answer vitest.a=1 --answer 'vitest.b=it'\\''s' --registry https://example.com/r --no-install --yes",
  );
});

test("reproduceCommand omits registry and --no-install by default", () => {
  expect(
    reproduceCommand({
      directory: "app",
      layout: "single",
      modules: ["bun"],
      answers: {},
      registry: undefined,
      install: true,
    }),
  ).toBe("aokit create app --layout single --modules bun --yes");
});
