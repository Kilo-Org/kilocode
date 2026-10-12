# Pinned upstream v2 baseline

Status: living. Refreshed 2026-10-11 by the discovery phase on `kilo-v2-clean-bootstrap`. Supersedes the 2026-08-13 capture at `76dbaf20` (old branch `johnnyeric/v2-baseline`); that capture survives in git history only.

This file records the upstream commit the Kilo v2 line is built on, the validation commands that this tree defines, and the result of running them. Compare any failing check against this file before you attribute it to a change (`migration-context.md`, Conventions).

## Refs

| Ref | SHA | Date | Subject |
|---|---|---|---|
| Upstream base (pinned) | `5e73d5cb1f788637b1b3d5cf1298ea694cbad0c5` | 2026-10-08 | `feat(core): add Google Cloud credential setup for Vertex (#53798)` |
| Release marker `v2.0.26` | `9b4ec5714d481559990db0a816d5dec19541a814` | — | Version-bump commit whose parent is the base. It is not on `upstream/v2` and is not a merge target |
| `upstream/v2` at capture | `d2905b8ddae8b0353cd2166d68d59795397921db` | 2026-10-09 | `feat(ai): add Vertex AI Interactions route (#54175)`. 31 commits ahead of the base |
| Integration branch `v2` | `5e73d5cb` | — | Equal to the base |
| Phase branch `kilo-v2-clean-bootstrap` (HEAD) | `a876c2912a5fd114066ce34e3a3fcc79f7f0a1b0` | 2026-10-11 | Base plus 2 documentation commits (`c4042b39a1`, `a876c2912a`). No source changes |
| V1 target `origin/main` | `fb7e96eda5409517a05948b9efaf01c53997bf6e` | 2026-10-09 | `Merge pull request #14893 …` |

The `packages/cli` version at the base is `2.0.25`, because the bump to 2.0.26 lives only in the tag commit.

## Ancestry

| Check | Result |
|---|---|
| `git merge-base --is-ancestor 5e73d5cb upstream/v2` | true |
| `git rev-list --count 5e73d5cb..HEAD` | 2 (documentation only) |
| `git merge-base 5e73d5cb fb7e96ed` | `0e2dd4ad` (`chore: generate`, 2026-06-26): the dev/v2 divergence point, also the last common commit with Kilo v1 |
| Commits from `0e2dd4ad` to the base | 4,343 |
| Commits from `0e2dd4ad` to V1 | 18,848 |

## Toolchain (this host)

| Tool | This host | Upstream CI |
|---|---|---|
| bun | 1.4.2 (equals `packageManager` `bun@1.4.2`) | from `package.json` via `.github/actions/setup-bun` |
| node | v24.13.0 | 24 for install and unit; 26.4.0 for the Node build step |
| git | 2.50.1 (Apple Git-155) | runner default |
| OS | macOS 26.3.1 (25D2128), arm64 | `blacksmith-4vcpu-ubuntu-2404`, `blacksmith-4vcpu-windows-2025` |
| `/bin/bash` | GNU bash 3.2.57 (macOS system bash) | bash 5.x on Linux runners |
| `rg` on PATH | absent | present on runners (UNVERIFIED; inferred from green upstream unit runs) |
| ffmpeg | absent | — |

The working tree also contains ignored leftover directories from an earlier v1 checkout (for example `packages/kilo-*` holding only `node_modules`). They are not tracked, are not workspaces of this tree, and do not affect the checks below.

## Validation commands defined by this tree

Derived from the root `package.json`, `.github/workflows/check.yml`, `.github/workflows/test.yml` and per-package scripts at the base.

| Purpose | Command | Working dir | Run by upstream CI |
|---|---|---|---|
| Install | `bun install` | root | yes |
| Lint and typecheck (pre-push hook, `check.yml`) | `bun run check` (= `bun run lint && bun run typecheck`) | root | yes |
| Typecheck all packages | `bun typecheck` (= `bun turbo typecheck --concurrency=3`) | root | yes, inside `check` |
| Unit tests | `GITHUB_ACTIONS=false bun turbo test --continue` (CI adds `--affected --concurrency=3`) | root (turbo runs each package's own `test`) | yes |
| Effect simplification lint | `bun run lint:effect-simplifications`, `bun run test:effect-simplification-rules` | root | yes |
| Effect pattern lint | `bun run lint:effect-patterns` | root | no |
| Generated client | `bun run check:generated` | `packages/client` | yes (Linux) |
| Generated docs | `bun run check:generated` | `services/www` | yes (Linux) |
| Generated protocol OpenAPI | `bun run check:generated` | `packages/protocol` | no |
| CLI build | `bun run script/build.ts --single --skip-install` | `packages/cli` | yes |
| Service smoke | `bun run script/service-smoke.ts` (isolated `HOME`/XDG temp dir) | `packages/cli` | yes |
| Node build and smoke | `bun run script/build-node.ts --single --skip-install --outdir=dist/node`, then `service-smoke.ts --node` | `packages/cli` | yes (Node 26.4.0) |

Constraints:

- Tests cannot run from the root (`bunfig.toml` test root `do-not-run-tests-from-root`). Run them from a package directory or through turbo.
- Never run `tsc`. Packages use `tsgo` through `bun typecheck`.
- `.husky/pre-push` checks the bun version, then runs `bun run check`.
- `check.yml` runs on pushes to `dev`/`v2` and on pull requests whose base is `dev` or `v2`. `test.yml` runs on every `pull_request`. **Changed 2026-10-12:** the Kilo integration branch was renamed to `v2`, so upstream's `check.yml` triggers now match pushes to `origin/v2` and pull requests that target it. Whether it runs on the fork, passes, or fails for lack of admin-configured secrets or Actions permissions is UNVERIFIED. CI/admin follow-up: observe the first pull request into `origin/v2` and record the result here (relates to U-E0-04 and the Actions-permissions admin task). The 2026-10-11 capture found no pull request targeting the integration branch or `kilo-v2-clean-bootstrap` (`gh pr list`).
- `packages/www` no longer exists. Generated docs live in `services/www`, and `typecheck.yml` was replaced by `check.yml`.

## Results on the phase branch (2026-10-11)

HEAD `a876c291` carries no source changes, so these are the results for pristine upstream `5e73d5cb`.

| Check | Result | Detail |
|---|---|---|
| `bun install` | pass | "Checked 2477 installs across 2941 packages (no changes)". `bun.lock` unchanged |
| `bun typecheck` | pass | 36/36 turbo tasks. The first run was a full turbo cache replay, so it was re-run with `--force`: 36/36 pass, 0 cached, 22.3 s |
| `bun run lint` | pass | oxlint: 1,509 warnings, 0 errors. ast-grep gui-extensions scan and sdk-docs: 0 problems |
| `bun run check` (lint + typecheck) | pass | Follows from the two rows above |
| `bun run lint:effect-simplifications` | pass | |
| `bun run lint:effect-patterns` | **fail** | 27 errors: 20 `no-star-import`, 4 `no-effect-die-string`, 2 `no-json-parse-cast`, 1 `no-import-alias`. Not run by CI |
| `GITHUB_ACTIONS=false bun turbo test --continue` | **fail** | 26/27 tasks pass. Only `@opencode/core#test` fails: 6,535 pass, 30 fail (see below) |
| `packages/client` `check:generated` | pass | No drift |
| `services/www` `check:generated` | pass | |
| `packages/protocol` `check:generated` | **fail** | "Generated OpenAPI document is stale". Regenerating gives `openapi.json` +951/−70 lines (for example, new `404 LocationNotFoundError` responses). Not run by CI. The file was restored after the probe; the tree is clean |
| `packages/cli` build + `service-smoke.ts` | pass | 50 s build, smoke exits 0 |
| Node build + `service-smoke --node` | not run | CI pins Node 26.4.0; this host has 24.13.0 |
| Upstream CI at the base | green | `gh api …/commits/5e73d5cb/check-runs`: `typecheck`, `unit (linux)`, `unit (windows)`, `e2e (linux)`, `e2e (windows)`, `build-cli` and the signing jobs all succeed |

## Current reds

Recorded as found, without fixes. None comes from a Kilo change: the tree has none.

### Host-environment failures (green on upstream CI)

1. **`@opencode/core` shell tests, 7 cases.** `ShellTool conditional process substitution` (4: legacy and native, `once` and `always`), `ShellTool compound syntax approval compatibility` (2) and `real-shell compound syntax > bash` (1). Output: `/bin/bash: wait: pid … is not a child of this shell`, exit 127. Probable cause: macOS system bash 3.2. Linux runners use bash 5.
2. **`@opencode/core` ripgrep-backed tests, 23 cases.** `Ripgrep > …` (11) and `search tools > …` (12). Cause: `Ripgrep.Error: ripgrep execution failed` → `HttpClientError: Transport error (GET https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/…)`. No `rg` is on PATH, and the in-test download is refused even though the URL is reachable from a normal shell. Install `rg` to clear it (UNVERIFIED).

The failures recorded for `76dbaf20` (`opencode-drive` JSON parse, the tui footer `Café`, `pa-PK` ICU, ffmpeg) do not reproduce at this base: the `app` and `tui` suites pass, and `opencode-drive` no longer exists in this tree.

### Not gated by CI

3. `lint:effect-patterns`: 27 errors.
4. `packages/protocol` `check:generated`: stale `openapi.json`.

Use these only as deltas against this table.

## Out of scope for this baseline

- **Kilo packages.** The base contains no `kilo-*` package (`git ls-tree HEAD packages/`). Kilo package checks (`kilo-vscode` typecheck, `bun run extension`, JetBrains Gradle build) start once each package lands. Each landing records its own baseline row here.
- **Fork CI.** No Kilo-owned workflow exists on this branch, and repo or Actions settings are an admin task (`migration-context.md`, Deferred admin tasks).

## Reproducer

`migration-tracking/technical-notes/script/v2-baseline.ts` **does not run on this base** as written. It hard-codes `PINNED_V2 = 76dbaf20`, refuses to run unless `upstream/v2` equals that pin, and targets `packages/www`. It is classified rewrite-or-drop in `migration-tracking/discovery/doc-inventory.md`. Until it is rewritten, reproduce with the commands in the table above, run from the listed directories. This capture used a throwaway script outside the repo with the same sequence: install, typecheck (`--force` re-run), lint, turbo test `--continue`, the three `check:generated` commands, then CLI build and service smoke.
