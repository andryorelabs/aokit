import { defineMigration } from "@aokit/module";

const oldSkillPath = ".claude/skills/adr/SKILL.md";
const newSkillPath = ".claude/skills/add-adr/SKILL.md";

/**
 * Drops the pre-rename `adr` skill once the `add-adr` skill exists, so an updated Project keeps a
 * single copy.
 */
export default defineMigration(({ vfs }) => {
  if (vfs.read(oldSkillPath) !== undefined && vfs.read(newSkillPath) !== undefined) {
    vfs.delete(oldSkillPath);
  }
});
