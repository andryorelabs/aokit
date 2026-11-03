import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listFiles } from "./build.ts";

/**
 * Compares two directory trees byte for byte and returns the sorted relative paths that are
 * missing from either side or differ in content.
 */
export async function diffDirectories(expectedDir: string, actualDir: string): Promise<string[]> {
  const expected = await listFiles(expectedDir);
  const actual = await listFiles(actualDir);
  const paths = [...new Set([...expected, ...actual])];
  const differs = await Promise.all(
    paths.map(async (path) => {
      if (!expected.includes(path) || !actual.includes(path)) {
        return true;
      }
      const [left, right] = await Promise.all([
        readFile(join(expectedDir, path)),
        readFile(join(actualDir, path)),
      ]);
      return !left.equals(right);
    }),
  );
  return paths.filter((_path, position) => differs[position] === true).toSorted();
}
