# Stability

What aokit promises across versions and which versions get fixes. Terms follow [GLOSSARY.md](../GLOSSARY.md).

## Versioning

The CLI follows semver. While the major version is 0, a minor release may include breaking changes and a patch release never does. Registry Releases are dated, not semver, as decided in [ADR-0026](adr/0026-registry-releases-are-dated-cli-versions-are-semver.md).

Release notes are on [GitHub Releases](https://github.com/andryorelabs/aokit/releases); see the [changelog](../CHANGELOG.md).

## Security fixes

Only the latest version receives security fixes. To report a vulnerability, follow [SECURITY.md](../.github/SECURITY.md); the threat model is in [Security model](security.md).
