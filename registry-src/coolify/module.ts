import { defineModule } from "@aokit/module";

export default defineModule({
  name: "coolify",
  version: "1.0.0",
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
});
