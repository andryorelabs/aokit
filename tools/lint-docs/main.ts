import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { LYCHEE_ARGS, LYCHEE_ASSETS, LYCHEE_VERSION } from "./args";

const repoRoot = resolve(import.meta.dir, "../..");
const lycheeCacheRoot = join(repoRoot, "node_modules/.cache/lychee");
const cacheDirectory = join(lycheeCacheRoot, LYCHEE_VERSION);
const binaryPath = join(cacheDirectory, "lychee");

/**
 * Downloads the pinned lychee archive, verifies its sha256 and installs the
 * binary into the cache. Throws on a checksum mismatch.
 */
async function installLychee(): Promise<void> {
  const platformKey = `${process.platform}-${process.arch}`;
  const asset = LYCHEE_ASSETS[platformKey];
  if (asset === undefined) {
    throw new Error(`No pinned lychee build for ${platformKey}`);
  }
  const url = `https://github.com/lycheeverse/lychee/releases/download/lychee-v${LYCHEE_VERSION}/${asset.archive}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Downloading ${url} failed with HTTP ${response.status}`);
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== asset.sha256) {
    throw new Error(
      `sha256 mismatch for ${asset.archive}: expected ${asset.sha256}, got ${actual}`,
    );
  }
  const staging = await mkdtemp(join(lycheeCacheRoot, "staging-"));
  try {
    const archivePath = join(staging, asset.archive);
    await writeFile(archivePath, archive);
    const extract = Bun.spawnSync([
      "tar",
      "xzf",
      archivePath,
      "-C",
      staging,
      "--strip-components=1",
    ]);
    if (extract.exitCode !== 0) {
      throw new Error(`Extracting ${asset.archive} failed: ${extract.stderr.toString()}`);
    }
    await mkdir(cacheDirectory, { recursive: true });
    await rename(join(staging, "lychee"), binaryPath);
    await chmod(binaryPath, 0o755);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  if (!existsSync(binaryPath)) {
    await mkdir(lycheeCacheRoot, { recursive: true });
    await installLychee();
  }
  const run = Bun.spawn([binaryPath, ...LYCHEE_ARGS], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await run.exited;
}

process.exit(await main());
