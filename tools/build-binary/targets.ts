export interface BinaryTarget {
  readonly bunTarget: Bun.Build.CompileTarget;
  readonly os: "linux" | "darwin" | "windows";
  readonly cpu: "x64" | "arm64";
  readonly libc: "glibc" | "musl";
  readonly bindingSuffix: string;
  readonly outputName: string;
}

const knownOperatingSystems = ["linux", "darwin", "windows"] as const;
const knownCpus = ["x64", "arm64"] as const;

function pickKnown<Known extends string>(
  known: readonly Known[],
  value: string | undefined,
): Known | undefined {
  return known.find((candidate) => candidate === value);
}

/** Parses a `bun build --compile` target such as `bun-linux-x64-musl` into its binding and output names. */
export function parseBinaryTarget(bunTarget: string): BinaryTarget {
  const [prefix, osName, cpuName, ...modifiers] = bunTarget.split("-");
  const os = pickKnown(knownOperatingSystems, osName);
  const cpu = pickKnown(knownCpus, cpuName);
  if (prefix !== "bun" || os === undefined || cpu === undefined) {
    throw new Error(`Unsupported --target "${bunTarget}"; expected bun-<os>-<arch>[-musl].`);
  }
  const libc = modifiers.includes("musl") ? "musl" : "glibc";
  if (libc === "musl" && os !== "linux") {
    throw new Error(`Unsupported --target "${bunTarget}"; musl exists only on linux.`);
  }
  const bindingSuffix = {
    linux: `linux-${cpu}-${libc === "musl" ? "musl" : "gnu"}`,
    darwin: `darwin-${cpu}`,
    windows: `win32-${cpu}-msvc`,
  }[os];
  const outputName = `aokit-${os}-${cpu}${libc === "musl" ? "-musl" : ""}${os === "windows" ? ".exe" : ""}`;
  const compileTarget: Bun.Build.CompileTarget =
    libc === "musl" ? `bun-linux-${cpu}-musl` : `bun-${os}-${cpu}`;
  return { bunTarget: compileTarget, os, cpu, libc, bindingSuffix, outputName };
}
