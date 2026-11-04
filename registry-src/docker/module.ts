import { defineModule } from "@aokit/module";

export default defineModule({
  name: "docker",
  version: "1.1.0",
  provides: [
    { capability: "deploy", cardinality: "many" },
    { capability: "container", cardinality: { max: 1 } },
  ],
  files: [
    { from: "files/Dockerfile", to: "Dockerfile", target: "root", ownership: "managed" },
    { from: "files/dockerignore", to: ".dockerignore", target: "root", ownership: "managed" },
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## docker\n\nDocker containerizes the Project for deployment.\n\nKey files:\n\n- `Dockerfile`: the image build.\n- `.dockerignore`: files kept out of the build context.\n",
    },
  ],
});
