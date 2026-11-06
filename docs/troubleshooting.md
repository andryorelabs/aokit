# Troubleshooting

Each entry gives the symptom you see, its cause and the fix. Error codes and exit codes are listed in the [CLI reference](reference/cli.md#exit-codes). Terms follow [GLOSSARY.md](../GLOSSARY.md).

## The command stops with exit 5 and lists dirty paths

**Symptom:** `DIRTY_TREE`, exit `5`, a list of uncommitted paths. No Plan is shown.

**Cause:** Commands that write project files require a clean working tree, so your own work stays recoverable with git.

**Fix:** Commit or stash your changes and run the command again. To proceed anyway, pass `--allow-dirty`.

## The command says the directory is not an aokit Project

**Symptom:** `LOCKFILE_MISSING`, exit `5`.

**Cause:** There is no readable `aokit.lock.json` in the directory.

**Fix:** Run the command inside the Project, or pass `--directory <path>`. To start a Project, use `aokit create`.

## An untrusted Registry is refused

**Symptom:** `REGISTRY_UNTRUSTED`, exit `5`, in CI, with `--yes` or under a coding agent.

**Cause:** Non-interactive runs never ask for trust, and `--yes` never grants it.

**Fix:** Run the exact `--trust <name|source>` form printed in the error, or add the Registry to `trustedRegistries` in `$XDG_CONFIG_HOME/aokit/config.json`. Trust only Registries you would run a script from; see the [security model](security.md#the-trust-gate).

## An integrity mismatch is reported

**Symptom:** `REGISTRY_INTEGRITY_MISMATCH`, exit `1`, naming the Registry, the Module and both hashes.

**Cause:** The files a Registry served do not match the integrity in its index or in your Lockfile: a corrupted download, a stale cache, or a Registry that changed a published version.

**Fix:** Retry once to rule out a corrupted download. If it repeats, do not trust the Registry's version; pin another version or report the Registry owner. Never edit the hash in the Lockfile to silence the error.

## A Registry cannot be fetched

**Symptom:** `REGISTRY_FETCH_FAILED`, exit `1`, with the URL and the cause.

**Cause:** Network failure, a wrong URL or `github:` ref, or a private source without credentials.

**Fix:** Check the URL and your connection, then retry. The Project is unchanged.

## A Registry environment variable is unset

**Symptom:** `REGISTRY_ENV_UNSET`, exit `2`, naming the variable.

**Cause:** A namespaced Registry in the user config references `${VAR}` in its `url` or `headers` and the variable is not in the environment.

**Fix:** Export the variable and run the command again.

## The command needs a newer CLI

**Symptom:** `MIN_CLI_VERSION`, exit `5`.

**Cause:** The Registry release declares a `minCliVersion` above your CLI version.

**Fix:** Run the version the error names with `bunx aokit@<minCliVersion>`, or download a newer binary from the [releases page](https://github.com/andryorelabs/aokit/releases).

## The merge left conflicts

**Symptom:** Exit `6`, files with conflict markers or `<name>.aokit-new` copies.

**Cause:** Your edits and the new Render changed the same lines, or a binary file differs.

**Fix:** Resolve the markers or the `.aokit-new` copies, then run `aokit doctor`. To undo, run `aokit update --abort` after `update`, or `aokit layout migrate --abort` after a Layout migration.

## `update --apply` refuses a saved Plan

**Symptom:** `PLAN_STALE` or `PLAN_MISSING`, exit `5`.

**Cause:** Files or the Lockfile changed after `update --plan`, or no Plan was saved.

**Fix:** Run `aokit update --plan` again, review it, then `aokit update --apply`.

## `check` exits 2 in CI

**Symptom:** The CI step fails with exit `2` and `UPDATE_AVAILABLE`.

**Cause:** This is the intended gate: a newer Release or Module version exists.

**Fix:** Run `aokit update --plan`, review and apply it. To ignore updates in a job, do not gate on `aokit check`.

## `doctor` exits 1 with Drift

**Symptom:** `DRIFT`, exit `1`, a list of files in `modified`, `deleted` or `unknown` state.

**Cause:** Files changed after generation. That is normal for files you edited.

**Fix:** Follow the command `doctor` prints for each file: `aokit restore <path>` to return to the Render, or `aokit eject <path>` to stop managing it.

## Removing a Module fails with dependents

**Symptom:** `DEPENDENTS_EXIST`, exit `4`.

**Cause:** Other selected Modules still require what this Module provides.

**Fix:** Remove the dependents first, or run `aokit remove <module> --cascade`.

## The selection is rejected before anything is built

**Symptom:** `REQUIREMENT_UNMET`, `CAPABILITY_CONFLICT` or `CARDINALITY_EXCEEDED`, exit `4`.

**Cause:** The Resolver found a Module that needs a Capability nothing provides, two Modules that conflict, or too many providers of one Capability. The raw code is in `error.data.resolverCode` with `--json`.

**Fix:** Change the `--modules` list as the message suggests.

## A prompt is expected but the command fails

**Symptom:** `MISSING_VALUE`, exit `3`, naming a flag.

**Cause:** No TTY, `--yes`, `CI` or a detected coding agent switched the run to non-interactive mode, so a value without a default cannot be asked.

**Fix:** Pass the flag the error names. To get prompts back, run in a terminal without `--yes` and with `CI` unset.

## The update notice is unwanted

**Symptom:** A line on stderr says a newer CLI exists.

**Cause:** The once-a-day update notice.

**Fix:** Set `AOKIT_NO_UPDATE_NOTIFIER=1`. It is already off in CI, with `--json` and with `--quiet`.
