import { defineModule } from "@aokit/module";

export default defineModule({
  name: "docker",
  version: "1.0.0",
  provides: [
    { capability: "deploy", cardinality: "many" },
    { capability: "container", cardinality: { max: 1 } },
  ],
  files: [
    { from: "files/Dockerfile", to: "Dockerfile", target: "root", ownership: "managed" },
    { from: "files/dockerignore", to: ".dockerignore", target: "root", ownership: "managed" },
  ],
});
