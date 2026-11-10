import { defineModule } from "@aokit/module";

export default defineModule({
  name: "docker-static",
  version: "1.0.1",
  description: "Dockerfile that serves a static build from a minimal web server container.",
  provides: [
    { capability: "deploy", cardinality: "many" },
    { capability: "container", cardinality: { max: 1 } },
  ],
  requires: ["web:static"],
  files: [
    { from: "files/Dockerfile", to: "Dockerfile", target: "root", ownership: "managed" },
    { from: "files/dockerignore", to: ".dockerignore", target: "root", ownership: "managed" },
    { from: "files/nginx.conf", to: "nginx.conf", target: "root", ownership: "managed" },
    {
      from: "files/docker-entrypoint.sh",
      to: "docker-entrypoint.sh",
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
        "\n## docker-static\n\nDocker serves the static web Target: a Bun build stage, then nginx.\n\nKey files:\n\n- `Dockerfile`: builds the site with Bun and copies `dist/` into nginx.\n- `nginx.conf`: the server block with security headers and the SPA fallback.\n- `docker-entrypoint.sh`: checks the build output and the nginx config at start.\n- `.dockerignore`: files kept out of the build context.\n\nIt provides `container`, so it cannot be selected together with `docker`.\n",
    },
  ],
});
