/**
 * Arguments passed to lychee by `bun run lint:docs`. The `lint-docs.yml`
 * workflow must pass exactly these, which `parity.test.ts` asserts.
 */
export const LYCHEE_ARGS: readonly string[] = [
  "--offline",
  "--include-fragments=anchor-only",
  "--no-progress",
  "docs/**/*.md",
  "*.md",
];

/** Pinned lychee release; `LYCHEE_ASSETS` holds the sha256 of each archive. */
export const LYCHEE_VERSION = "0.24.2";

export type LycheeAsset = {
  readonly archive: string;
  readonly sha256: string;
};

/** Release archives by `${process.platform}-${process.arch}`. */
export const LYCHEE_ASSETS: Readonly<Record<string, LycheeAsset>> = {
  "linux-x64": {
    archive: "lychee-x86_64-unknown-linux-gnu.tar.gz",
    sha256: "1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a",
  },
  "linux-arm64": {
    archive: "lychee-aarch64-unknown-linux-gnu.tar.gz",
    sha256: "91a7bd65685da41b90ccb9bc867a3d649a7818042dae04ff405e55a25bddee4c",
  },
  "darwin-x64": {
    archive: "lychee-x86_64-apple-darwin.tar.gz",
    sha256: "887503a9cff667d322b8d0892b40bf49976eb9507af8483220a3706cdad55978",
  },
  "darwin-arm64": {
    archive: "lychee-aarch64-apple-darwin.tar.gz",
    sha256: "c9d3740ea2d891854d37116c9fba840f37b6e7c89d330e7db84ac333631c4977",
  },
};
