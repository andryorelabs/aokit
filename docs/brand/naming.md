# Naming

The name stays `aokit`. This page records why and how it is written. Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Decision

The tool, the npm package and the GitHub repository keep the name `aokit`. The identity is built around the existing name, not a new one.

## Why it stays

- It is already the name in the code, the docs, the CLI, the Lockfile and the `AOKIT_*` environment variables ([CLI reference](../reference/cli.md)). A rename would change every one of them for no gain in clarity.
- It is short, lowercase and easy to type: `bunx aokit create my-app`.
- The scoped contract package is already named `@aokit/module` and the creator package `create-aokit`, so the family is consistent.

## How it is written

| Where                           | Form                                        |
| ------------------------------- | ------------------------------------------- |
| The tool, in prose and headings | `aokit`, always lowercase, never `Aokit`    |
| The start of a sentence         | Rephrase, or keep `aokit` lowercase         |
| Commands and flags              | In backticks, copied from the CLI reference |
| The wordmark                    | `aokit` in Geist Medium (500), lowercase    |
| Packages                        | `aokit`, `create-aokit`, `@aokit/module`    |
| The name of a generated Project | Whatever the user chooses                   |

Glossary terms keep their own capitalisation: Project, Module, Registry and Lockfile are capitalised, the tool is not.

## Do not

- Write AOKit, Aokit or AoKit.
- Add a suffix or a tagline to the name in the wordmark. The brand line sits beside or under it.
- Abbreviate it.
