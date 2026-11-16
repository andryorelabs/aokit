# Cut a release

Ship a CLI version, then verify it. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The branch model is in [ADR-0030](../adr/0030-develop-is-the-trunk.md); the repository settings it relies on are in [Development](../development.md#repository-settings).

## Release a version

1. Run `bun run release` from the root. It bumps the version with bumpp and opens the release pull request against `develop`. It creates no tag.
2. Merge the pull request into `develop`.
3. Promote `develop` into `main` with a pull request merged with a merge commit. The commit message check does not run on a promotion, because its commits are the squash commits already on `develop`.
4. Push the signed tag `v<version>` on the promotion merge commit. A tag on a commit that `main` does not contain fails the release workflow at "Tag is on main".
5. The Release workflow publishes `aokit`, `create-aokit` and `@aokit/module` with provenance. A tag whose version is already on npm fails with E403, so every release needs a new version.

## Verify

Check the binaries against the published checksums and attestations:

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify aokit-linux-x64 --repo <owner>/<repo>
```

Then create a throwaway project from the published package:

```sh
bunx create-aokit@next smoke-app
```

Run it in a temporary directory and delete it afterwards.

## One-time owner setup

The owner-only wizard `tools/release/human-steps.sh` does the setup that a tag cannot. Run it from the root. It needs `gh` (signed in), `npm` and `bun`, and has 11 stages. Each publishing stage asks for confirmation first, and the ruleset stage skips rulesets that exist. Do not re-run a publishing stage for a version that is already on npm: it fails with E403.

1. First publish of `0.1.0-next.0` with a granular npm token: builds the package, publishes `aokit` then `create-aokit` under the dist-tag `next`, then asks you to revoke the token.
2. Trusted publishers on npmjs.com: for `aokit` and `create-aokit`, set Trusted Publisher to GitHub Actions for this repository, workflow `release.yml`, environment empty.
3. npm org `aokit`: create it on the free plan so it owns the `@aokit` scope.
4. First publish of `@aokit/module` with a token: published from `packages/module/dist` under `latest`, or `next` for a pre-release version.
5. Trusted publisher for `@aokit/module`: same settings as step 2.
6. Repository rulesets: applies `.github/rulesets/main.json`, `develop.json` and `tags.json`, skipping any that exist.
7. Labels: creates or updates every label in `.github/labels.yml`.
8. Delete `BLACKSMITH_RUNNER`: workflows fall back to `ubuntu-latest` once the variable is gone.
9. Private vulnerability reporting: enables the channel `.github/SECURITY.md` points to.
10. Smoke test: `bunx create-aokit@next smoke-app` in a temporary directory.
11. Verify a release: the steps in [Release a version](#release-a-version) and [Verify](#verify).

The token is read hidden, passed to npm for one command only and never written to disk.
