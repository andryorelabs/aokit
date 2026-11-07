# 0023. The brand kit lives in docs/brand and its rasters are generated

Status: Accepted (2026-11-07)
Spec: S1 to S10 (brand kit spec)
Architecture: [Brand kit](../brand/README.md)

## Context

aokit had no identity: no logo, palette, cover, banner or package metadata. The sibling projects of the same author (emet, animated-fluent-emojis, snug, andryore-web) each keep a documented brand kit in the repository; streamboss keeps it in a root `brand/` folder. A brand that lives outside the repository drifts from the README, the CLI and the package pages that use it, and agents that change those surfaces cannot see it.

## Decision

- The kit lives in `docs/brand/`: documents, `tokens.css`, `logo/`, `brandbook/`, `og/` and `terminal/`, plus the exploration sheets that record the decisions.
- SVG files, `tokens.css` and the HTML cover sources are authoritative. Every raster (mark PNGs, `favicon.ico`, covers, social previews) is generated only by `bun run brand:export` and committed, never edited by hand.
- Tokens are hex, the chosen values verbatim, so the palette in the documents, the SVG files and the covers cannot drift through a colour conversion.
- Geist and Geist Mono are committed under their OFL licence so the brandbook and the export run offline.
- The terminal banner is a pair of committed files, and a test fails unless the CLI constants are byte-identical to them.
- A test suite guards the kit: token contrast, SVG palette and accessibility attributes, raster dimensions and byte budgets.

## Consequences

- One place to read, review and change the brand; a change shows up in a pull request next to the code that uses it.
- Regenerating rasters needs Chromium and `sharp` on the machine that runs the export; tests only read the committed files, so CI does not need a browser.
- The repository grows by a few hundred kilobytes of fonts and PNG files.
- The visual identity is deliberately not shared with the sibling projects: only the process is.

## Alternatives considered

- **A root `brand/` folder** (streamboss): rejected, it splits documentation across two trees and the docs index test would not cover it.
- **A kit outside the repository**: rejected, agents and reviewers could not see or check it.
- **No kit, only a logo and a README banner**: rejected, copy, claims and palette would be undocumented and drift.
- **oklch tokens** (emet): rejected, the chosen palette is defined in hex and a conversion adds drift for no gain.
