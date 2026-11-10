import { defineModule } from "@aokit/module";

const seed = (name: string, to: string) => ({
  from: `files/${name}`,
  to,
  target: "root" as const,
  ownership: "seed" as const,
});

export default defineModule({
  name: "repo-docs",
  version: "1.0.1",
  description: "Repository docs: README, CONTRIBUTING, license and agent guidance files.",
  provides: [{ capability: "repo-docs", cardinality: { max: 1 } }],
  files: [
    seed("CODE_OF_CONDUCT.md", "CODE_OF_CONDUCT.md"),
    seed("CONTRIBUTING.md", "CONTRIBUTING.md"),
    seed("GOVERNANCE.md", "GOVERNANCE.md"),
    seed("CODEOWNERS", ".github/CODEOWNERS"),
    seed("editorconfig", ".editorconfig"),
    seed("git-blame-ignore-revs", ".git-blame-ignore-revs"),
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## repo-docs\n\nCommunity and repository hygiene files, written once as seeds you own.\n\nKey files:\n\n- `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `GOVERNANCE.md`: contributor-facing rules.\n- `.github/CODEOWNERS`: review ownership.\n- `.editorconfig`: editor defaults.\n- `.git-blame-ignore-revs`: commits `git blame` skips; add formatting-only commits here.\n",
    },
  ],
});
