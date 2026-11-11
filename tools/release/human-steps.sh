#!/usr/bin/env bash
#
# A wizard walks a human through a manual procedure, step by step.
# Owner-only release steps for aokit. Run from the repository root.
#
# Everything above the "STAGES" marker is the wizard library: do not hand-edit
# it. Author the per-step stages below the marker.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear wipes the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1 && tput clear 2>/dev/null; then return 0; fi
  printf '\033[2J\033[3J\033[H'
}

# banner "Title" shows the opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" clears the screen, then announces a stage and shows progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." prints a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." is a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL opens it in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else false; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

# pause "msg" waits for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY: current value of KEY in ENV_FILE, if any, with write_env's single
# quotes or a plain dotenv double-quoted value undone.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line value sq="'\\''"; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  value="${line#*=}"
  if [[ "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; value="${value//"$sq"/\'}"
  elif [[ "$value" == \"*\" ]]; then
    value="${value:1:${#value}-2}"
    [[ "$value" == *[\\\$\"]* ]] && return 1   # escapes, $ or ": can't decode safely; ask again
  fi
  printf '%s' "$value"
}

# ask KEY "Prompt" reads a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret), edited
# with Readline. Fails at EOF with no input.
ask() {
  local key="$1" prompt="$2" current input s=$'\001' e=$'\002' p rc=0
  current=$(_existing "$key" || true)
  # Readline needs the colour codes wrapped in \001..\002 to place the cursor.
  p="  $s$BOLD$e$prompt$s$RESET$e "
  [[ -n "$current" ]] && p+="$s$DIM$e[Enter keeps current]$s$RESET$e "
  read -e -r -p "$p" input || rc=1
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" is like ask, but input is hidden.
ask_secret() {
  local key="$1" prompt="$2" current input rc=0
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || rc=1
  printf '\n'
  if (( rc )) && [[ -z "$input" ]]; then return 1; fi
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE upserts KEY='VALUE' into ENV_FILE (replaces any existing
# line) and sets $KEY. Idempotent. Creates ENV_FILE at mode 0600; writes through
# a symlink and keeps an existing file's mode.
write_env() {
  local key="$1" value="$2" tmp sq="'\\''"
  [[ -e "$ENV_FILE" ]] || (umask 077 && : > "$ENV_FILE")
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf "%s='%s'\n" "$key" "${value//\'/$sq}" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
  printf -v "$key" '%s' "$value"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE sets a GitHub Actions repo secret via gh. Falls back
# to a warning (and records it) if gh is unavailable or unauthenticated.
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

# set_var NAME VALUE sets a GitHub Actions repo variable (non-secret).
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

# finish clears, then shows a closing summary of everything configured.
finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES: author this section. One stage() per step the human takes.
# Replace the example below. Set TOTAL_STAGES to match the stages you write.
# Keep every stage inside run_wizard and the last line as is: bash then parses
# the whole file before the first prompt, so an edit mid-run can't break it.
# ──────────────────────────────────────────────────────────────────────────

run_wizard() {

TOTAL_STAGES=11

banner "aokit release: owner steps"

REPO=""
require_tools() {
  local tool
  for tool in gh npm bun; do
    command -v "$tool" >/dev/null 2>&1 || { warn "$tool is required but not installed"; exit 1; }
  done
  gh auth status >/dev/null 2>&1 || { warn "run gh auth login first"; exit 1; }
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
}
require_tools

stage "First publish of 0.1.0-next.0 with a token"
say "Repository: $REPO. Publishes aokit then create-aokit under the dist-tag next."
say "The token is read hidden, passed to npm for one command only and never written to disk."
warn "This publishes to the public npm registry and cannot be undone."
if confirm "Publish aokit and create-aokit 0.1.0-next.0 now?"; then
  open_url "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new"
  step "Create a granular token: read and write on packages, short expiry."
  ask_secret NPM_PUBLISH_TOKEN "Paste the npm token:"
  PACK_DIR=$(mktemp -d)
  bun run build:package
  (cd packages/aokit && bun pm pack --destination "$PACK_DIR")
  (cd packages/create-aokit && bun pm pack --destination "$PACK_DIR")
  for package in aokit create-aokit; do
    (
      export "npm_config_//registry.npmjs.org/:_authToken=$NPM_PUBLISH_TOKEN"
      npm publish "$PACK_DIR/$package-0.1.0-next.0.tgz" --access public --tag next
    )
  done
  unset NPM_PUBLISH_TOKEN
  step "Revoke the token on npmjs.com now."
  pause "Press Enter once the token is revoked."
  note "Tarballs are left in $PACK_DIR; delete that directory when you are done."
else
  SKIPPED+=("First publish of 0.1.0-next.0")
fi

stage "Trusted publishers on npmjs.com"
say "Both packages must trust the release workflow before a tag can publish."
for package in aokit create-aokit; do
  open_url "https://www.npmjs.com/package/$package/access"
  step "Trusted Publisher, GitHub Actions: the owner and repository of $REPO."
  step "Workflow filename: release.yml. Environment name: leave empty. Save."
  pause "Press Enter when $package is configured."
done

stage "npm org aokit"
say "@aokit/module needs the npm organization aokit to own the @aokit scope."
open_url "https://www.npmjs.com/org/create"
step "Create the organization aokit on the free plan (public packages only)."
step "Keep your own account as the owner; add other maintainers later from the org page."
pause "Press Enter once the org aokit exists."

stage "First publish of @aokit/module with a token"
MODULE_VERSION=$(bun -e 'console.log((await Bun.file("packages/module/package.json").json()).version)')
MODULE_TAG=latest
[[ "$MODULE_VERSION" == *-* ]] && MODULE_TAG=next
say "Publishes @aokit/module $MODULE_VERSION under the dist-tag $MODULE_TAG."
say "bun run build:package stages the package in packages/module/dist, which is what gets packed."
say "The token is read hidden, passed to npm for one command only and never written to disk."
warn "This publishes to the public npm registry and cannot be undone."
if confirm "Publish @aokit/module $MODULE_VERSION now?"; then
  open_url "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new"
  step "Create a granular token: read and write on packages and on the aokit org, short expiry."
  ask_secret NPM_PUBLISH_TOKEN "Paste the npm token:"
  MODULE_PACK_DIR=$(mktemp -d)
  bun run build:package
  (cd packages/module/dist && bun pm pack --destination "$MODULE_PACK_DIR")
  (
    export "npm_config_//registry.npmjs.org/:_authToken=$NPM_PUBLISH_TOKEN"
    npm publish "$MODULE_PACK_DIR/aokit-module-$MODULE_VERSION.tgz" --access public --tag "$MODULE_TAG"
  )
  unset NPM_PUBLISH_TOKEN
  step "Revoke the token on npmjs.com now."
  pause "Press Enter once the token is revoked."
  note "The tarball is left in $MODULE_PACK_DIR; delete that directory when you are done."
else
  SKIPPED+=("First publish of @aokit/module $MODULE_VERSION")
fi

stage "Trusted publisher for @aokit/module"
say "Later versions of @aokit/module publish from the release workflow, like aokit and create-aokit."
open_url "https://www.npmjs.com/package/@aokit/module/access"
step "Trusted Publisher, GitHub Actions: the owner and repository of $REPO."
step "Workflow filename: release.yml. Environment name: leave empty. Save."
pause "Press Enter when @aokit/module is configured."

stage "Repository rulesets"
say "Applies .github/rulesets/main.json, develop.json and tags.json with gh api."
if confirm "Create the rulesets on $REPO?"; then
  for ruleset in main develop tags; do
    if gh api "repos/$REPO/rulesets" --jq '.[].name' | grep -qx "$ruleset"; then
      note "ruleset $ruleset already exists, skipping"
    else
      gh api "repos/$REPO/rulesets" --method POST --input ".github/rulesets/$ruleset.json" --silent
      printf '  %s✓ created%s ruleset %s\n' "$GREEN" "$RESET" "$ruleset"
    fi
  done
else
  SKIPPED+=("Rulesets: gh api repos/$REPO/rulesets --method POST --input .github/rulesets/<name>.json")
fi

stage "Labels"
say "Creates or updates every label in .github/labels.yml with gh api."
if confirm "Apply the labels to $REPO?"; then
  while IFS=$'\t' read -r name color description; do
    encoded=${name// /%20}
    if ! gh api "repos/$REPO/labels" --method POST -f name="$name" -f color="$color" -f description="$description" --silent 2>/dev/null; then
      gh api "repos/$REPO/labels/$encoded" --method PATCH -f color="$color" -f description="$description" --silent
    fi
    printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$name"
  done < <(bun -e 'for (const l of Bun.YAML.parse(await Bun.file(".github/labels.yml").text())) console.log([l.name, l.color, l.description ?? ""].join("\t"))')
else
  SKIPPED+=("Labels from .github/labels.yml")
fi

stage "Delete BLACKSMITH_RUNNER"
say "Workflows fall back to ubuntu-latest once the variable is gone."
note "Narrowing the routing in the workflows and runner-routing.test.ts is a code change, done separately."
if confirm "Delete the BLACKSMITH_RUNNER variable from $REPO?"; then
  gh variable delete BLACKSMITH_RUNNER --repo "$REPO" || warn "variable not found or already deleted"
else
  SKIPPED+=("gh variable delete BLACKSMITH_RUNNER")
fi

stage "Private vulnerability reporting"
say "Enables the channel that .github/SECURITY.md points reporters to."
if confirm "Enable private vulnerability reporting on $REPO?"; then
  gh api "repos/$REPO/private-vulnerability-reporting" --method PUT --silent
  printf '  %s✓ enabled%s\n' "$GREEN" "$RESET"
else
  SKIPPED+=("Private vulnerability reporting")
fi

stage "Smoke test: bunx create-aokit@next"
say "Creates a throwaway project from the published pre-release in a temporary directory."
if confirm "Run the smoke test?"; then
  SMOKE_DIR=$(mktemp -d)
  (cd "$SMOKE_DIR" && bunx create-aokit@next smoke-app)
  note "Output is in $SMOKE_DIR; delete it when you are done."
else
  SKIPPED+=("bunx create-aokit@next smoke test")
fi

stage "Verify a release"
say "0.1.0-next.0 is already on npm, so the first tag must carry a new version."
say "Run bun run release to bump (for example to 0.1.0-next.1); it opens the release pull request against develop."
say "Merge it, promote develop to main, then push the signed tag on the promotion merge commit."
say "The Release workflow then publishes with provenance; a tag equal to an existing version fails with E403."
say "Check the binaries with: sha256sum -c SHA256SUMS --ignore-missing"
say "and: gh attestation verify aokit-linux-x64 --repo $REPO"
pause "Press Enter to finish."

finish
}

run_wizard "$@"; exit
