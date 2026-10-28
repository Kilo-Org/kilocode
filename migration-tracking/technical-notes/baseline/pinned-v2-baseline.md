# Pinned upstream v2 baseline

Status: living. Refreshed 2026-10-27 on the `v2.1.4` sync branch `upstream-merge-2-1-4` (#15500). This capture describes the proposed sync, not a merge into `origin/v2`. It includes `v2.1.4` only, not `2.2`. The base moves with every upstream sync (plan A4), so re-measure after each sync. The earlier captures remain below. The 2026-08-13 capture at `76dbaf20` (old branch `johnnyeric/v2-baseline`) survives in git history only.

This file records the upstream release `origin/v2` is synced to, the validation commands that this tree defines, and the result of running them. Compare any failing check against this file, and against `origin/v2` before your change, before you attribute it to a change (`migration-context.md`, Conventions).

## Current capture: `v2.1.4` (2026-10-27)

### Refs and method

| Ref | SHA | Note |
|---|---|---|
| Sync branch (measured) | `7bb3cc3fdba7e1a50258f74f7f1cd91f9c9fcd49` | `upstream-merge-2-1-4`, PR #15500; sync merge `d8a8941f87`, Kilo plugin type annotation `f93d652376`, patch-limit correction `7bb3cc3fdb` |
| Pre-sync Kilo base | `80b01782c0` | Includes the branding work from #15417 |
| Previous upstream base | `37d973754ba6cc31732f93421c0c18b675841573` | Parent of `v2.1.3` |
| New upstream base | `74f8d4860f49c563909e6b039b0cc8b454ebce72` | Parent of `v2.1.4`; selected release target, not the tag or `2.2` |

Evidence combines isolated local checks during this sync with GitHub Actions on the measured commit. The full `v2-baseline.ts --checks` script was **not** rerun; this is not a fresh full local baseline capture. Local commands used Bun 1.4.4 through `npx` because the shell's Bun was 1.4.2. The current local host is macOS arm64 with Node v24.18.0. Tests used temporary `OPENCODE_TEST_HOME` and `XDG_*` directories. CLI self-tests used fresh `KILO_V2_PROFILE` directories and `--standalone`.

### Results

| Check | Result | Detail |
|---|---|---|
| `install --frozen-lockfile` | pass | Local; lockfile accepted after the merge |
| `bun run check` | pass | Local and pre-push hook with Bun 1.4.4: 28 typecheck tasks, lint 208 warnings and 0 errors. The explicit effect return type in the existing Kilo seam fixes Bun TS7023; no suppression or hook bypass |
| Official `typecheck:tsc` | pass | 28 local tasks, including all three Kilo packages. Their CI scripts were added because upstream's new official TypeScript task otherwise skipped them |
| Linux and Windows unit shards | pass, CI | [Test workflow at `7bb3cc3fdb`](https://github.com/Kilo-Org/kilocode/actions/runs/40521909682); all Linux and Windows unit jobs pass. This does not establish that every local macOS test passes |
| Kilo packages and macOS platform tests | pass, CI | [Kilo workflow at `7bb3cc3fdb`](https://github.com/Kilo-Org/kilocode/actions/runs/40521909666) |
| Core plugin/Kilo regressions | pass, local | 467 tests. Additional focused compaction, runner and changed-core suites passed during the sync |
| Kilo host regressions | pass, local | Full suite: 169 tests before the type-only seam annotation; plugin/RPC/updater rerun after the annotation: 38 tests |
| Gateway and Kilo plugin suites | pass, local | Gateway core 124, Kilo plugin 206 |
| AI suite | pass, local | 1,828 pass, 28 existing upstream skips; no skips added by this sync |
| Server suite and client checks | pass, local | Full server suite 95 tests; focused client suite 45 tests; client generation left no additional drift |
| Terminal MCP input lifecycle | pass, local | Four upstream MCP/Kilo lifecycle tests. Detached writes return an error and do not queue input for a later attachment |
| Source and compiled branding | pass, local | 51 branding tests include OAuth escaping, upstream controls, real TSX rendering and compiled fixtures. Smoke checks cover Kilo help, terminal title, update instructions and blocked OpenCode upgrades |
| Live CLI self-test | pass, local | Isolated Gateway request returned `SYNC_214_OK`. `debug heap-dump --help` and its no-server guard behaved as expected |
| Native Kilo build | pass, local and CI | Local `--single --skip-install`; CI builds `darwin-arm64` and `linux-x64` |
| CLI Linux/Windows builds and SDK package | pass, CI | Test workflow linked above |
| Sync tooling | pass | 89 local tests; CI sync-tooling job passes. The manifest transform now preserves Kilo scripts and exports with a three-way merge |
| Workflow allowlist, annotations, shared patches and progress map | pass | CI and local checks. Shared patches: 56 files, 437 marked and 39 unmarked lines against `74f8d4860f4` |
| Full local turbo test run, baseline script, effect-pattern audit and all generated-file checks | not rerun | Earlier captures are historical evidence, not results for this pin |
| Live browser sign-in and cross-platform binary execution | not run locally | OAuth rendering tests are not proof of live browser sign-in |

### CI failures resolved and remaining limits

- The first Linux unit run timed out in `config plugin reloads > loads skills when .agents appears after startup`. The test and reload code were unchanged by this sync. The isolated file passed 12/12, the exact failed 19-file batch passed 195/195, and one CI retry passed. All unit jobs also pass on `7bb3cc3fdb`; no test timeout or assertion was weakened.
- The shared-patch guard failed after the type annotation added one marked line. The limit was corrected from 436 to 437 in `7bb3cc3fdb`; the guard now passes. No additional shared behavior was added by that correction.
- A broad local TUI run with Bun's default timeout did not complete. Its two reported timeout cases passed in the isolated six-test file with the package's 30-second timeout. Focused changed-surface tests and Linux/Windows CI pass; do not describe this as a full local TUI pass.
- The 13 macOS shell/login-shell failures in the 2.1.3 capture were not remeasured as a set. They are historical platform notes, not newly verified failures or fixes at this pin.
- At this capture all executed build, unit, typecheck and Kilo guard jobs on #15500 pass. E2E jobs remain skipped by the existing fork workflow; Kilo Code Review is pending. A skipped job is not a pass.

### Migrated feature preservation

The compaction conflict keeps both Kilo provider billing and upstream background usage accounting. The branding adapter from #15417 stays in Kilo-owned code; its docs URL, restart sentence and update epilogue were adapted to the new upstream text. Host mirrors gained the new heap-dump handler and cross-libc install flag. The manifest export regression, missing Kilo CI typechecks and detached-terminal false-success path were fixed with regression coverage. Tracker output was regenerated without intentionally removing a completed feature or changing a completed disposition to dropped. These checks cover the affected paths; they are not an automated guarantee for every migrated feature or indirect dependency.

## Previous capture: `v2.1.3` (2026-10-23)

### Refs

| Ref | SHA | Date | Note |
|---|---|---|---|
| Sync branch (measured) | `021d6b31848` | 2026-10-23 | `sync-v2-1-3`: the `v2.1.3` sync merge `0d8ae9be328` plus `origin/v2` `2af82eef6a8` (#15405). After the later merge of `origin/v2` `aa7d29226e4` (#15345, #15407) at `d75e69380b1`, `check`, the generated-file checks, the Kilo checks and the `tui` (1,604), `plugin` (9), `kilo-plugin` (188) and `kilo-cli` (62) tests were run again and pass |
| Current upstream base | `37d973754ba6cc31732f93421c0c18b675841573` | 2026-10-22 | Release commit of `v2.1.3` (parent of the tag) |
| `upstream/dev` at capture | `2a3e7c0f349` | 2026-10-23 | 72 commits past the current base. Lag: 1 release (`v2.1.4`) |

Measured with `bun migration-tracking/technical-notes/script/v2-baseline.ts --checks` in a clean detached worktree outside the repository. Toolchain: bun 1.4.4 (the new `packageManager`), node v25.2.1, macOS 26.6 arm64, macOS bash 3.2, `rg` on PATH (Homebrew), login shell fish. `origin/v2` `2af82eef6a8` was measured with the same script (`--only test`) and bun 1.4.2.

### Results

| Check | Result | Detail |
|---|---|---|
| `install`, `check` (`bun run check`), effect simplification lint and rule tests | pass | `bun.lock` unchanged. `check`: 28/28 turbo tasks, oxlint 209 warnings, 0 errors |
| `test` (`bun turbo test --continue --force`, isolated) | **fail** | 25/26 tasks pass, 4 min 8 s. `@opencode/core`: 6,732 pass, 13 fail (`origin/v2`: 6,693 pass, the same 13 fail). All other packages pass, for example `@opencode/cli` 339, `@opencode/tui` 1,601, `@opencode/server` 87, `@kilocode/gateway-core` 104, `@kilocode/kilo-plugin` 188, `@kilocode/kilo-cli` 62 |
| `client`, `www`, `protocol` `check:generated` | pass | No drift |
| `sdk-verify-package`, `codemode-publish-dry-run` | pass | |
| CLI build, binary version, service smoke | pass | |
| Kilo build, host smoke, CLI startup ratchet | pass | |
| Workflow allowlist, annotations, shared patches, progress map, Kilo import rule | pass | Shared patches: 46 files, 334 marked and 39 unmarked lines against `37d973754ba` (at `d75e69380b1`) |
| Node build and smoke | not run | CI pins Node 26.4.0; this host has v25.2.1 |
| `lint:effect-patterns` | **fail** | 27 errors, unchanged. Not run by CI |

### Current reds

The 13 `@opencode/core` cases of the `v2.1.1` capture, unchanged. The failure set is identical on `origin/v2` `2af82eef6a8` (before the sync) on this host. None is attributable to the sync or to a Kilo change.

1. **macOS bash 3.2, 7 cases:** `ShellTool conditional process substitution` (4), `ShellTool compound syntax approval compatibility` (2), `real-shell compound syntax > bash` (1). Green on Linux CI.
2. **Login shell, 6 cases:** `Session.shell > …` (`packages/core/test/session-shell.test.ts`) times out when `SHELL` is fish. With `SHELL=/bin/zsh` the file passes (9 pass).

## Previous capture: `v2.1.1` (2026-10-23)

### Refs

| Ref | SHA | Date | Note |
|---|---|---|---|
| Sync branch (measured) | `3c4b1fdf849` | 2026-10-23 | `sync-v2-1-1`: the `v2.1.1` sync merge `b80adececc8` plus `origin/v2` `2663e72e7f8` (#15372) |
| Current upstream base | `e9ac459c2e62e3e5b04c13e2322ded2dc2680f65` | 2026-10-20 | Release commit of `v2.1.1` (parent of the tag) |
| `upstream/dev` at capture | `74f8d4860f4` | 2026-10-23 | 167 commits past the current base. Lag: 2 releases (`v2.1.2`, `v2.1.3`) |

Measured with `bun migration-tracking/technical-notes/script/v2-baseline.ts --checks` in a clean worktree. Toolchain: bun 1.4.2, node v25.2.1, macOS 26.6 arm64, macOS bash 3.2, `rg` on PATH (Homebrew), login shell fish.

### Results

| Check | Result | Detail |
|---|---|---|
| `install`, `check` (`bun run check`), effect simplification lint and rule tests | pass | `bun.lock` unchanged. `check`: 28/28 turbo tasks, oxlint 213 warnings, 0 errors |
| `test` (`bun turbo test --continue --force`, isolated) | **fail** | 25/26 tasks pass, 4 min 6 s. `@opencode/core`: 6,693 pass, 13 fail. All other packages pass, for example `@opencode/cli` 339, `@opencode/tui` 1,559, `@opencode/server` 87, `@kilocode/gateway-core` 101, `@kilocode/kilo-plugin` 173, `@kilocode/kilo-cli` 53 |
| `client`, `www`, `protocol` `check:generated` | pass | No drift |
| `sdk-verify-package`, `codemode-publish-dry-run` | pass | |
| CLI build, binary version, service smoke | pass | |
| Kilo build, host smoke, CLI startup ratchet | pass | |
| Workflow allowlist, annotations, shared patches, progress map, Kilo import rule | pass | Shared patches: 42 files, 275 marked and 39 unmarked lines against `e9ac459c2e6` |
| Node build and smoke | not run | CI pins Node 26.4.0; this host has v25.2.1 |
| `lint:effect-patterns` | **fail** | 27 errors, unchanged. Not run by CI |

### Current reds

The same 13 `@opencode/core` cases fail on `origin/v2` `a1e74c10d7d` (before the sync) on this host. None is attributable to the sync or to a Kilo change.

1. **macOS bash 3.2, 7 cases, unchanged:** `ShellTool conditional process substitution` (4), `ShellTool compound syntax approval compatibility` (2), `real-shell compound syntax > bash` (1). Green on Linux CI.
2. **Login shell, 6 cases, new on this host:** `Session.shell > …` (`packages/core/test/session-shell.test.ts`) times out after 5 s when `SHELL` is fish. With `SHELL=/bin/zsh` the file passes (9 pass).
3. The 23 ripgrep-backed cases of the previous capture pass now that `rg` is on PATH.
4. Outside turbo, `packages/cli/test/debug-paths.test.ts` fails when `OPENCODE_TEST_HOME` is set (it expects the real home directory). It passes without that variable and in the turbo run.

## Previous capture: `v2.0.30` (2026-10-16)

### Refs

| Ref | SHA | Date | Note |
|---|---|---|---|
| `origin/v2` (measured) | `98ead1f27eab2fc9e48fa664ec9cf0df3280427c` | 2026-10-16 | `Merge pull request #15178`. Upstream `v2.0.30` plus Kilo changes: `packages/kilo-gateway-core`, `packages/kilo-plugin`, sync tooling, docs, removed upstream apps (#15151) |
| Current upstream base | `775d1d0d7138fd9b4de455186ff2c1b1e2505a3b` | 2026-10-15 | Release commit of `v2.0.30` (parent of the tag), merged by #15136 |
| `upstream/dev` at capture | `07bbd0fd166` | 2026-10-16 | 58 commits past the current base. Lag: 2 releases (`v2.0.31`, `v2.0.32`), 1 day |
| Initial base | `5e73d5cb1f788637b1b3d5cf1298ea694cbad0c5` | 2026-10-08 | See the previous capture |

The `packages/cli` version at the current base is `2.0.29`, because the bump to 2.0.30 lives only in the tag commit. Toolchain: the same host as the previous capture (bun 1.4.2, node v24.13.0, macOS bash 3.2, no `rg`, no ffmpeg). Tests ran with isolated `OPENCODE_TEST_HOME` and `XDG_*` directories in a clean worktree.

### Results

| Check | Result | Detail |
|---|---|---|
| `bun install` | pass | 1,163 packages installed in a fresh worktree; `bun.lock` unchanged |
| `bun typecheck` (`--force`) | pass | 27/27 turbo tasks, 0 cached, 35 s. Includes `@kilocode/gateway-core` and `@kilocode/kilo-plugin` |
| `bun run lint` | pass | Now `oxlint` only (the gui-extensions scan left with #15151): 214 warnings, 0 errors |
| `bun run lint:effect-simplifications`, `test:effect-simplification-rules` | pass | 10/10 rule tests |
| `bun run lint:effect-patterns` | **fail** | 27 errors, unchanged: 20 `no-star-import`, 4 `no-effect-die-string`, 2 `no-json-parse-cast`, 1 `no-import-alias`. Not run by CI |
| `GITHUB_ACTIONS=false bun turbo test --continue --force` | **fail** | 22/25 tasks pass, 8 min 22 s. `@opencode/core`: 6,593 pass, 37 fail. `@opencode/cli`: 1 fail. `@opencode/tui`: 1 fail. 9 of these 39 are load flakes (see below) |
| `packages/client` `check:generated` | pass | No drift |
| `services/www` `check:generated` | pass | |
| `packages/protocol` `check:generated` | pass | No longer stale (it was at the initial base) |
| `packages/cli` build + `service-smoke.ts` | pass | Smoke exits 0 |
| Node build + `service-smoke --node` | not run | CI pins Node 26.4.0; this host has 24.13.0 |
| Kilo CI on `origin/v2` | green | Push of `98ead1f27e`: `typecheck`, `unit (linux)`, `unit (windows)`, `shared upstream patches`, `upstream sync tooling tests`, `workflow allowlist`, `migration progress map` succeed; `e2e` skipped. `e2e` is skipped on the fork since #15151 (`affected` in `test.yml` is `if: false`); it still ran on the sync PR #15136, where Windows failed and Linux passed |

### Current reds

None is attributable to a Kilo change. The failing tests do not exercise the 14 shared files Kilo changes (`bun script/check-shared-patches.ts`), the 30 host-environment cases fail the same way at the initial base, and the rest pass when re-run alone.

1. **Host environment, 30 cases in `@opencode/core`, unchanged from the previous capture:** 7 shell cases (macOS bash 3.2) and 23 ripgrep-backed cases (no `rg`; `Ripgrep > …` 11, `search tools > …` 12). Green on Linux CI.
2. **Load flakes, 9 cases, pass when re-run alone:** `util.flock` (4) and `util.effect-flock` (2) stale-lock recovery, `ConfigInstructionPlugin.Plugin > reloads configured sources…` (core); `export is raw by default…` (`packages/cli/test/import-export.test.ts`, timed out at 211 s); `the pane edge matches the visible reviewed card in light mode` (`packages/tui/test/cli/tui/diff-viewer.test.tsx`, timed out). Each passed in an isolated re-run of its file (core 35 pass, cli 5 pass, tui 104 pass with the package's `--timeout 30000`). Treat a failure here as a flake only after one isolated re-run.
3. **Not gated by CI:** `lint:effect-patterns`, 27 errors.

### Kilo packages

| Package | typecheck | test |
|---|---|---|
| `@kilocode/gateway-core` | pass | 36 pass, 0 fail |
| `@kilocode/kilo-plugin` | pass | 1 pass, 0 fail |

## Validation commands defined by this tree

Derived from the root `package.json`, `.github/workflows/check.yml`, `.github/workflows/test.yml` and per-package scripts. The local/official compiler distinction below was refreshed for `v2.1.4`; result coverage is stated in the current capture.

| Purpose | Command | Working dir | Run by upstream CI |
|---|---|---|---|
| Install | `bun install` | root | yes |
| Local lint and typecheck (pre-push hook) | `bun run check` (= `bun run lint && bun run typecheck`) | root | CI runs lint and official TypeScript separately |
| Local typecheck all packages | `bun typecheck` (= `bun turbo typecheck --concurrency=3`) | root | no; upstream packages use Bun's checker locally |
| Official TypeScript for all packages | `bun run typecheck:tsc` | root | yes, `check.yml`; Kilo packages define this script too |
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
- Use package scripts, not direct compiler invocations. `bun typecheck` uses Bun's checker in upstream packages and official TypeScript in Kilo packages. `bun run typecheck:tsc` uses official TypeScript; it is the source of truth when the compilers disagree.
- `.husky/pre-push` checks the bun version, then runs `bun run check`.
- `check.yml` and `test.yml` run on pushes to branches named `dev` or `v2`, and on every pull request. Upstream's `check.yml` filters pushes and pull requests by branch (`[dev, v2]` at the initial base, `[dev]` at `v2.0.30`). Kilo changed it on 2026-10-13 (#15016; `.github/workflows/check.yml:5-7`, marked): `v2` is in the push branches and the pull-request trigger is unfiltered, so a PR into `v2` or into a stacked PR branch is checked. `test.yml` already runs on every pull request upstream; Kilo added `v2` to its push branches. **Verified 2026-10-16:** `typecheck` (`check.yml`), `unit (linux)` and `unit (windows)` (`test.yml`) and the `kilo-v2.yml` jobs run on the fork; `typecheck` ran and passed on #15192, whose base is `fold-plan-delta`. `e2e` is skipped on the fork since #15151 (`affected` in `test.yml` is `if: false`); it still ran on #15136, where Windows failed and Linux passed. The 2026-10-11 capture had found no pull request targeting the integration branch or `kilo-v2-clean-bootstrap` (`gh pr list`).
- `packages/www` no longer exists. Generated docs live in `services/www`, and `typecheck.yml` was replaced by `check.yml`.

## Previous capture: initial base (2026-10-11)

Recorded by the discovery phase on `kilo-v2-clean-bootstrap`. Kept as evidence; the sections below describe that capture.


### Refs

| Ref | SHA | Date | Subject |
|---|---|---|---|
| Upstream base (pinned) | `5e73d5cb1f788637b1b3d5cf1298ea694cbad0c5` | 2026-10-08 | `feat(core): add Google Cloud credential setup for Vertex (#53798)` |
| Release marker `v2.0.26` | `9b4ec5714d481559990db0a816d5dec19541a814` | — | Version-bump commit whose parent is the base. It is not on `upstream/v2` and is not a merge target |
| `upstream/v2` at capture | `d2905b8ddae8b0353cd2166d68d59795397921db` | 2026-10-09 | `feat(ai): add Vertex AI Interactions route (#54175)`. 31 commits ahead of the base |
| Kilo integration branch `origin/v2` | `5e73d5cb` | — | Equal to the base |
| Phase branch `kilo-v2-clean-bootstrap` (HEAD) | `a876c2912a5fd114066ce34e3a3fcc79f7f0a1b0` | 2026-10-11 | Base plus 2 documentation commits (`c4042b39a1`, `a876c2912a`). No source changes |
| V1 target `origin/main` | `fb7e96eda5409517a05948b9efaf01c53997bf6e` | 2026-10-09 | `Merge pull request #14893 …` |

The `packages/cli` version at the base is `2.0.25`, because the bump to 2.0.26 lives only in the tag commit.

### Ancestry

| Check | Result |
|---|---|
| `git merge-base --is-ancestor 5e73d5cb upstream/v2` | true |
| `git rev-list --count 5e73d5cb..HEAD` | 2 (documentation only) |
| `git merge-base 5e73d5cb fb7e96ed` | `0e2dd4ad` (`chore: generate`, 2026-06-26): the dev/v2 divergence point, also the last common commit with Kilo v1 |
| Commits from `0e2dd4ad` to the base | 4,343 |
| Commits from `0e2dd4ad` to V1 | 18,848 |

### Toolchain (this host)

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

### Results on the phase branch (2026-10-11)

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

### Reds at the initial base

Recorded as found, without fixes. None comes from a Kilo change: the tree has none.

#### Host-environment failures (green on upstream CI)

1. **`@opencode/core` shell tests, 7 cases.** `ShellTool conditional process substitution` (4: legacy and native, `once` and `always`), `ShellTool compound syntax approval compatibility` (2) and `real-shell compound syntax > bash` (1). Output: `/bin/bash: wait: pid … is not a child of this shell`, exit 127. Probable cause: macOS system bash 3.2. Linux runners use bash 5.
2. **`@opencode/core` ripgrep-backed tests, 23 cases.** `Ripgrep > …` (11) and `search tools > …` (12). Cause: `Ripgrep.Error: ripgrep execution failed` → `HttpClientError: Transport error (GET https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/…)`. No `rg` is on PATH, and the in-test download is refused even though the URL is reachable from a normal shell. Install `rg` to clear it (UNVERIFIED).

The failures recorded for `76dbaf20` (`opencode-drive` JSON parse, the tui footer `Café`, `pa-PK` ICU, ffmpeg) do not reproduce at this base: the `app` and `tui` suites pass, and `opencode-drive` no longer exists in this tree.

#### Not gated by CI

3. `lint:effect-patterns`: 27 errors.
4. `packages/protocol` `check:generated`: stale `openapi.json`.

Use these only as deltas against this table.

## Out of scope for this baseline

- **Kilo packages beyond the table above.** Kilo package checks (`kilo-vscode` typecheck, JetBrains Gradle build) start once each package lands. Each landing adds its row to "Kilo packages" in the current capture.
- **Fork CI settings.** `kilo-v2.yml` runs the Kilo jobs; repo and Actions settings stay an admin task (`migration-context.md`, Deferred admin tasks).

## Reproducer

From the repository root, in a clean worktree:

```sh
bun migration-tracking/technical-notes/script/v2-baseline.ts            # refs and ancestry only, offline
bun migration-tracking/technical-notes/script/v2-baseline.ts --checks   # plus every check, logs in baseline/logs/ (gitignored)
bun migration-tracking/technical-notes/script/v2-baseline.ts --checks --only test,cli-build   # a subset, for example one re-run
```

The script takes the base from `pinned()` (`script/upstream/utils/upstream.ts`), so it follows each sync without an edit, and refuses to run the checks unless the pin is an ancestor of `HEAD` and of `upstream/dev` (when that ref exists locally). `--checks` runs the commands of `check.yml`, `test.yml` and `kilo-v2.yml` in CI order, plus the two checks CI does not run (`lint:effect-patterns`, `packages/protocol` `check:generated`, reported but not failing the run). It runs turbo test with `--force` and isolated `OPENCODE_TEST_HOME` and `XDG_*` directories. The CI steps it does not mirror, and why, are listed at the top of the script.

The 2026-10-23 capture used the script. The older captures predate it. The 2026-10-16 capture used a throwaway script outside the repo with the same isolation, in a clean worktree, and the sequence of the table above (turbo test also `--force`). The 2026-10-11 capture used the sequence: install, typecheck (`--force` re-run), lint, turbo test `--continue`, the three `check:generated` commands, then CLI build and service smoke.
