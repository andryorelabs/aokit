import { defineModule } from "@aokit/module";

export default defineModule({
  name: "posthog",
  version: "1.0.0",
  provides: [{ capability: "analytics", cardinality: { max: 1 } }],
  requires: ["web:app-router", "ext:web.providers@^1"],
  files: [
    {
      from: "files/src/instrumentation-client.ts",
      to: "src/instrumentation-client.ts",
      target: "web",
      ownership: "managed",
    },
    {
      from: "files/src/analytics/provider.tsx",
      to: "src/analytics/provider.tsx",
      target: "web",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      "posthog-js": { range: "catalog" },
    },
  },
  env: [
    { key: "NEXT_PUBLIC_POSTHOG_KEY", scope: "web", visibility: "client", example: "" },
    {
      key: "NEXT_PUBLIC_POSTHOG_HOST",
      scope: "web",
      visibility: "client",
      example: "https://us.i.posthog.com",
    },
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## posthog\n\nPostHog product analytics for the Next web Target (Next only in v1).\n\nKey files:\n\n- `src/instrumentation-client.ts`: initializes posthog-js when `NEXT_PUBLIC_POSTHOG_KEY` is set.\n- `src/analytics/provider.tsx`: the client provider, registered through `web.providers`.\n",
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      from: "./analytics/provider",
      named: ["AnalyticsProvider"],
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      element: "AnalyticsProvider",
    },
  ],
});
