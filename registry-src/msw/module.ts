import { defineModule } from "@aokit/module";

export default defineModule({
  name: "msw",
  version: "1.0.0",
  files: [
    { from: "files/handlers.ts", to: "src/mocks/handlers.ts", target: "root", ownership: "seed" },
    { from: "files/server.ts", to: "src/mocks/server.ts", target: "root", ownership: "seed" },
    {
      from: "files/vitest.setup.ts",
      to: "src/mocks/vitest.setup.ts",
      target: "root",
      ownership: "seed",
    },
  ],
  deps: {
    devDependencies: {
      msw: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## msw\n\nMSW mocks network requests in tests.\n\nKey files:\n\n- `src/mocks/handlers.ts`: the request handlers, yours to extend.\n- `src/mocks/server.ts`: the Node server built from the handlers.\n- `src/mocks/vitest.setup.ts`: starts, resets and stops the server around tests; add it to `setupFiles` in your Vitest config.\n",
    },
  ],
});
