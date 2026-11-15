---
name: cut-release
description: Cut a release of this project. Use when the user asks to release, tag or publish a new version.
---

# Cutting a release

1. Read the release runbook (`docs/how-to/cut-a-release.md` when it exists) and follow it; this skill only orders the steps.
2. Confirm the working tree is clean and you are on the trunk branch, up to date with the remote.
3. Run the full local check script (`bun run ci:local` when it exists, otherwise `check` and `test`) and stop on any failure.
4. Check that `[Unreleased]` in `CHANGELOG.md` has entries. If the project's release script moves them into a dated section for the new version, leave that to the script; otherwise move them by hand.
5. Bump the version with the project's release script, never by hand, and open the release pull request.
6. After the pull request merges, tag the merge commit as `v<version>` and push the tag. Never move or reuse a tag.
7. Verify the published artifacts against their checksums, then report the version and the links.
