import { readdir, stat } from "node:fs/promises";
import { AokitError } from "../cli/envelope.ts";

/**
 * Accepts a missing or empty target directory; anything else fails with exit code 3 and a
 * suggestion. Runs before `--dry-run` and `--diff`.
 */
export async function checkTarget(directory: string): Promise<void> {
  let info;
  try {
    info = await stat(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new AokitError(
      "INVALID_INPUT",
      `target \`${directory}\` exists and is not a directory`,
      "choose another directory, for example `aokit create my-app`",
    );
  }
  if ((await readdir(directory)).length > 0) {
    throw new AokitError(
      "INVALID_INPUT",
      `target directory \`${directory}\` is not empty`,
      `choose another directory, for example \`aokit create ${directory}-2\`, or empty \`${directory}\` first`,
    );
  }
}
