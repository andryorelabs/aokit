---
name: wxt
description: Work on the WXT browser extension Target. Use when adding entrypoints (popup, background, content scripts, options), changing the manifest or building the extension.
---

# Working with WXT

1. Entrypoints live in `entrypoints/`; WXT builds one manifest entry per file or folder there (`background.ts`, `popup/`, `options/`, `*.content.ts`).
2. The manifest is generated from `wxt.config.ts` (`manifest`) plus the entrypoints. Add permissions and host permissions there, not by hand-writing a `manifest.json`.
3. The popup is a React app: `entrypoints/popup/index.html` loads `main.tsx`, which renders `App.tsx`. Add more React entrypoints the same way.
4. Define the background with `defineBackground` and content scripts with `defineContentScript`, imported from `wxt/utils/define-background` and `wxt/utils/define-content-script`.
5. Use `browser` from `wxt/browser` for extension APIs; it works on Chromium and Firefox.
6. Run `bun run ext:dev` to launch a browser with hot reload, `bun run ext:build` for the production build in `.output/`, and `bun run ext:zip` for a store package.
7. The scripts are named `ext:*` so they never collide with a web base's `dev` and `build`.
