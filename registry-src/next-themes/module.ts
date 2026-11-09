import { defineModule } from "@aokit/module";

export default defineModule({
  name: "next-themes",
  version: "1.0.0",
  requires: ["web:app-router", "ext:web.providers@^1"],
  files: [
    {
      from: "files/src/theme/provider.tsx",
      to: "src/theme/provider.tsx",
      target: "web",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      "next-themes": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## next-themes\n\nnext-themes adds light and dark theme switching to the Next web Target.\n\nKey files:\n\n- `src/theme/provider.tsx`: the client theme provider, registered through `web.providers`; it toggles the `class` attribute on `<html>` and follows the system theme by default.\n\nRead or change the theme with `useTheme` from `next-themes`. Add `suppressHydrationWarning` to `<html>` in the root layout to avoid a hydration warning.\n",
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      from: "./theme/provider",
      named: ["ThemeProvider"],
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      element: "ThemeProvider",
    },
  ],
});
