# Applying the brand

Which asset feeds which surface, what to regenerate or edit when the brand changes, and what stays manual. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The files below are created by the brand kit spec; paths in code spans that do not exist yet are linked once they land. Decisions are in [ADR 0023](../adr/0023-brand-kit-in-docs-brand.md).

## Asset to surface

| Asset                                           | Feeds                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `docs/brand/copy.md`                            | README, `llms.txt`, package descriptions and keywords, GitHub About         |
| `docs/brand/tokens.css`                         | The brandbook, the cover sources, the palette and contrast tests            |
| `docs/brand/logo/*.svg`                         | README, brandbook, covers, mark PNGs                                        |
| `docs/brand/brandbook/`                         | The offline reference page and the committed Geist fonts                    |
| `docs/brand/logo/png/*` and `favicon.ico`       | Package pages, favicons, any raster use of the mark                         |
| `docs/brand/og/cover.png`, `cover-light.png`    | README `<picture>`, npm READMEs through the `raw.githubusercontent.com` URL |
| `docs/brand/og/social-preview*.png`             | The GitHub social preview upload                                            |
| `docs/brand/terminal/banner.ansi`, `banner.txt` | The CLI banner constants, byte-identical, checked by a test                 |

## What to run or edit when the brand changes

| Change                    | Edit                                                                                                             | Then run                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| A colour                  | `docs/brand/tokens.css`, `tools/brand/palette.ts`, the SVG files, the cover sources                              | `bun run brand:export`, `bun run test` |
| The logo                  | `docs/brand/logo/*.svg`                                                                                          | `bun run brand:export`, `bun run test` |
| A string                  | `docs/brand/copy.md` first, then `README.md`, `llms.txt`, the two npm READMEs and the three `package.json` files | `bun run lint:docs`                    |
| The banner                | `docs/brand/terminal/banner.ansi` and `banner.txt`, then the constants in `packages/aokit/src/cli/banner.ts`     | `bun run test`                         |
| The fonts                 | `docs/brand/brandbook/fonts/` and its `OFL.txt`                                                                  | `bun run brand:export`, `bun run test` |
| A document in this folder | The document, and its row in [README.md](README.md) and [docs/README.md](../README.md)                           | `bun run test`                         |

Rasters are generated only by `bun run brand:export` and committed; never edit one by hand. Colours come only from the Soot palette.

## Manual steps

These are not automated and are done by a maintainer.

- GitHub About, homepage and topics, from [copy.md](copy.md):

  ```sh
  gh repo edit andryorelabs/aokit --homepage "https://github.com/andryorelabs/aokit#readme" --add-topic cli,bun,typescript,scaffolding,project-generator,codegen,mcp
  ```

  The description is set from the "GitHub About" string in [copy.md](copy.md).

- The social preview: upload `docs/brand/og/social-preview.png` in the repository settings. GitHub has no API for it.
- The npm page: after the first release, check that the description, keywords, README and cover render on each package page.

## Files by ticket

The kit is added in these groups, one per implementation ticket:

- Documents: `docs/brand/brief.md`, `naming.md`, `competitors.md`, `voice.md`, `copy.md`, `apply-spec.md` (this ticket, AO-2907).
- Tokens, logo and fonts: `docs/brand/tokens.css`, `docs/brand/logo/*.svg`, `docs/brand/brandbook/fonts/`, `tools/brand/palette.ts` and tests (AO-2908).
- Banner and URL: `docs/brand/terminal/banner.ansi`, `docs/brand/terminal/banner.txt`, `packages/aokit/src/cli/banner.ts` and the repository URL fix (AO-2909).
- Brandbook page: `docs/brand/brandbook/index.html` and `fonts.css` (AO-2910).
- Mark rasters: `docs/brand/logo/png/*` and the export script `tools/brand/brand-export.ts` (AO-2911).
- Covers and social previews: `docs/brand/og/*` (AO-2912).
- README, `llms.txt`, npm READMEs and `package.json` metadata (AO-2913).
