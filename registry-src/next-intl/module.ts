import { defineModule } from "@aokit/module";

export default defineModule({
  name: "next-intl",
  version: "1.0.0",
  provides: [{ capability: "i18n", cardinality: { max: 1 } }],
  requires: ["web:app-router", "ext:next.plugins@^1", "ext:web.providers@^1"],
  files: [
    { from: "files/src/proxy.ts", to: "src/proxy.ts", target: "web", ownership: "managed" },
    {
      from: "files/src/i18n/routing.ts",
      to: "src/i18n/routing.ts",
      target: "web",
      ownership: "managed",
    },
    {
      from: "files/src/i18n/messages.ts",
      to: "src/i18n/messages.ts",
      target: "web",
      ownership: "managed",
    },
    {
      from: "files/src/i18n/request.ts",
      to: "src/i18n/request.ts",
      target: "web",
      ownership: "managed",
    },
    {
      from: "files/src/i18n/provider.tsx",
      to: "src/i18n/provider.tsx",
      target: "web",
      ownership: "managed",
    },
    {
      from: "files/src/messages/en.json",
      to: "src/messages/en.json",
      target: "web",
      ownership: "seed",
    },
  ],
  deps: {
    dependencies: {
      "next-intl": { range: "catalog" },
    },
  },
  override: [
    { file: "web:src/proxy.ts", reason: "replaces the pass-through proxy with locale detection" },
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## next-intl\n\nnext-intl translates the web Target without locale-prefixed routes; the locale comes from the `NEXT_LOCALE` cookie.\n\nKey files:\n\n- `src/i18n/routing.ts`: the supported locales and the default; add a locale here and a matching file in `src/messages/`.\n- `src/i18n/messages.ts`: the message catalogs shared by the server and client; register each new catalog in `catalogs`.\n- `src/i18n/request.ts`: the server request config that loads the messages.\n- `src/i18n/provider.tsx`: the client provider, registered through `web.providers`.\n- `src/messages/en.json`: the English messages, yours to edit.\n- `src/proxy.ts`: sets the locale cookie from `Accept-Language`; next-intl owns this file, so another Module that needs the proxy must compose with it.\n",
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "next.plugins",
      range: "^1",
      from: "next-intl/plugin",
      default: "createNextIntlPlugin",
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "next.plugins",
      range: "^1",
      element: 'createNextIntlPlugin("./src/i18n/request.ts")',
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      from: "./i18n/provider",
      named: ["IntlProvider"],
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      element: "IntlProvider",
    },
  ],
});
