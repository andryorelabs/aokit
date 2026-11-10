import { defineModule } from "@aokit/module";

export default defineModule({
  name: "renovate",
  version: "1.0.1",
  description: "Automated dependency update pull requests with Renovate.",
  provides: [{ capability: "dep-updates", cardinality: { max: 1 } }],
  files: [
    { from: "files/renovate.json", to: "renovate.json", target: "root", ownership: "managed" },
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## renovate\n\nRenovate opens weekly dependency update pull requests.\n\nKey files:\n\n- `renovate.json`: the Renovate policy, at the Project root. Toolchain pin groups are never automerged.\n",
    },
  ],
});
