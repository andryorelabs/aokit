import { expect, test } from "bun:test";
import { sourceStringIdentity } from "../../src/trust/identity.ts";

test("URL identity ignores case and the default port but keeps scheme and path", () => {
  const base = sourceStringIdentity("https://r.test/reg");
  expect(sourceStringIdentity("https://R.test:443/reg")).toBe(base);
  expect(sourceStringIdentity("https://r.test/reg2")).not.toBe(base);
  expect(sourceStringIdentity("https://r.test/")).not.toBe(base);
  expect(sourceStringIdentity("http://r.test/reg")).not.toBe(base);
});

test("a lookalike host never shares an identity, userinfo does not change the server", () => {
  const base = sourceStringIdentity("https://r.test/reg");
  expect(sourceStringIdentity("https://user@r.test/reg")).toBe(base);
  expect(sourceStringIdentity("https://r.test.evil/reg")).not.toBe(base);
  expect(sourceStringIdentity("https://evil.test@r.test/reg")).toBe(base);
  expect(sourceStringIdentity("https://r.test@evil.test/reg")).not.toBe(base);
});

test("github identity is the repository, whatever the ref", () => {
  expect(sourceStringIdentity("github:acme/mods#main")).toBe(
    sourceStringIdentity("github:acme/mods#v2"),
  );
  expect(sourceStringIdentity("github:acme/other#main")).not.toBe(
    sourceStringIdentity("github:acme/mods#main"),
  );
});
