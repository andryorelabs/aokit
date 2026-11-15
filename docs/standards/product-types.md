# Product types

Rules that apply by product type: CLI, plugin, site and bilingual projects. Index: [standards](README.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

Each rule is marked **must**, **should** or **may**, names the project types it applies to, gives one sentence, then the reason. The type words are defined in the [legend](README.md#levels-and-project-types).

- **I1** (V39, should, CLI) The CLI prints one JSON envelope on every `--json` path, including `--help` and `--version`. Reason: a script or an agent parses one shape and never special-cases the help output.
- **I2** (V39, must, CLI) The CLI contract holds, apart from the envelope in I1:
  - the exit-code map is 0, 1, 2 and 3, and a CLI may use further codes when its CLI reference documents them;
  - an unknown flag is rejected;
  - SIGINT exits with 130;
  - colour follows `NO_COLOR`, `FORCE_COLOR`, `--no-color`, `TERM=dumb` and whether the output is a TTY;
  - human output sits beside `--json`;
  - every command has `--help`;
  - the update notice is quiet and cached.

  Reason: every CLI behaves the same way in a terminal, a pipe and CI.

- **I3** (V40, must, plugin) Plugin contract tests check that a skill name equals its directory and its description has "Use when", that hook matchers are registered, that agent frontmatter pins model and effort, and that agents reading untrusted input get restricted tools; a launcher fails closed where hooks guard. Reason: a plugin that loads wrongly or guards nothing is worse than none.
- **I4** (V41, should, site) A site serves `/.well-known/security.txt` and a hash-based CSP header with a unit test, audits third-party content in the built output, keeps a Lighthouse budget and has a public-files contract test. Reason: a site's exposed surface is tested, not assumed.
- **I5** (V42, must, bilingual) A bilingual project has an i18n parity check, run as `i18n:status`. Reason: a missing translation fails a script, not a reader.
