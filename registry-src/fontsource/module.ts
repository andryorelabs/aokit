import { defineModule } from "@aokit/module";

export default defineModule({
  name: "fontsource",
  version: "1.0.1",
  description: "Self-hosted fonts through Fontsource packages.",
  requires: ["ext:web.styles@^1"],
  deps: {
    dependencies: {
      "@fontsource-variable/geist": { range: "catalog" },
      "@fontsource-variable/geist-mono": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        '\n## fontsource\n\nFontsource self-hosts the Geist and Geist Mono variable fonts for the web Target.\n\nBoth packages are imported for their side effects through `web.styles`; reference them in CSS as `"Geist Variable"` and `"Geist Mono Variable"`. Other families are out of scope: add their `@fontsource-variable/*` package and import it by hand.\n',
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "web.styles",
      range: "^1",
      from: "@fontsource-variable/geist",
      sideEffect: true,
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "web.styles",
      range: "^1",
      from: "@fontsource-variable/geist-mono",
      sideEffect: true,
    },
  ],
});
