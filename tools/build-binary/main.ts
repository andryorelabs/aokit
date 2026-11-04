import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildBinary } from "./build.ts";

const repoRoot = join(import.meta.dir, "..", "..");

const { values } = parseArgs({ options: { target: { type: "string" } } });
const hostTarget = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;

const outputPath = await buildBinary({ repoRoot, bunTarget: values.target ?? hostTarget });
console.log(outputPath);
