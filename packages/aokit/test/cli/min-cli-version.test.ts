import { expect, test } from "bun:test";
import { meetsMinCliVersion } from "../../src/cli/min-cli-version.ts";

test.each([
  ["0.1.0", "0.1.0"],
  ["0.1.0-next.0", "0.1.0"],
  ["0.1.1-next.0", "0.1.0"],
  ["1.0.0", "0.1.0"],
  ["0.1.0+build.1", "0.1.0"],
])("CLI %s meets minCliVersion %s", (cliVersion, minCliVersion) => {
  expect(meetsMinCliVersion(cliVersion, minCliVersion)).toBe(true);
});

test.each([
  ["0.0.9", "0.1.0"],
  ["0.1.0-next.0", "0.2.0"],
  ["0.0.9-next.0", "0.1.0"],
])("CLI %s does not meet minCliVersion %s", (cliVersion, minCliVersion) => {
  expect(meetsMinCliVersion(cliVersion, minCliVersion)).toBe(false);
});
