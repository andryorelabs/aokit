import { expect, test } from "bun:test";
import { parseBinaryTarget } from "./targets.ts";

test("a target with an unknown operating system or a wrong prefix is rejected", () => {
  expect(() => parseBinaryTarget("bun-plan9-x64")).toThrow('Unsupported --target "bun-plan9-x64"');
  expect(() => parseBinaryTarget("node-linux-x64")).toThrow("expected bun-<os>-<arch>[-musl]");
  expect(() => parseBinaryTarget("bun-linux-riscv")).toThrow("Unsupported --target");
});

test("musl is rejected outside linux", () => {
  expect(() => parseBinaryTarget("bun-darwin-arm64-musl")).toThrow("musl exists only on linux");
});

test("a linux musl target binds the musl package", () => {
  expect(parseBinaryTarget("bun-linux-x64-musl")).toMatchObject({
    os: "linux",
    cpu: "x64",
    libc: "musl",
    bindingSuffix: "linux-x64-musl",
  });
});
