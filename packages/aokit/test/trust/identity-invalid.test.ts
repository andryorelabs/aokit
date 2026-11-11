import { expect, test } from "bun:test";
import { sourceStringIdentity } from "../../src/trust/identity.ts";

test("an http source that is not a valid URL has no identity", () => {
  expect(sourceStringIdentity("https://")).toBeUndefined();
  expect(sourceStringIdentity("http://[bad")).toBeUndefined();
});

test("a source that is not a URL, github or Namespace has no identity", () => {
  expect(sourceStringIdentity("./local/path")).toBeUndefined();
});
