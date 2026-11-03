import type { UserConfig } from "@commitlint/types";

/**
 * Conventional commits. Gitmoji after the type (`feat: ✨ add x`) is the
 * house convention but is not enforced.
 */
const commitlintConfig: UserConfig = {
  extends: ["@commitlint/config-conventional"],
};

export default commitlintConfig;
