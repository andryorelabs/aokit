import { defineModule } from "@aokit/module";

export default defineModule({
  name: "coolify",
  version: "1.1.1",
  description: "Deploy configuration for self-hosted Coolify.",
  provides: [{ capability: "deploy", cardinality: "many" }],
  requires: ["container"],
  files: [
    {
      from: "files/docker-compose.coolify.yaml",
      to: "docker-compose.coolify.yaml",
      target: "root",
      ownership: "managed",
    },
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## coolify\n\nCoolify deploys the container image from a compose file.\n\nKey files:\n\n- `docker-compose.coolify.yaml`: the compose definition Coolify runs.\n",
    },
  ],
});
