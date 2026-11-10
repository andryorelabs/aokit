# @aokit/module

The Module manifest contract for [aokit](https://github.com/andryorelabs/aokit) Module authors. Write a Module in TypeScript with `defineModule`, compile it to a `module.json` manifest with `compileModule`, and serve it from a Registry.

## Install

```sh
bun add -d @aokit/module
```

Use the same version as the `aokit` CLI your users run, so the manifest you type-check is one that CLI accepts.

## Example

```ts
import { defineModule } from "@aokit/module";

export default defineModule({
  name: "my-lint-staged",
  version: "1.0.0",
  provides: [{ capability: "staged-lint", cardinality: { max: 1 } }],
  requires: ["git-hooks"],
  files: [
    {
      from: "files/lintstagedrc.json",
      to: ".lintstagedrc.json",
      target: "config",
      ownership: "managed",
    },
  ],
  deps: {
    devDependencies: {
      "lint-staged": { range: "^16.0.0" },
    },
  },
});
```

The full walkthrough is in [Writing a Module](https://github.com/andryorelabs/aokit/blob/main/docs/guide/writing-modules.md).

## Stability

This package is 0.x and versioned in lockstep with `aokit`. See the [stability policy](https://github.com/andryorelabs/aokit/blob/main/docs/stability.md#module-sdk).
