# Configuration regression review — PR #13513

## Scope and method

Reviewer 6/7; configuration-discovery lens only. **Verdict: safe to merge for this lens; no PR-introduced configuration-discovery regression found.** One pre-existing managed-configuration policy question is separated below and does not block this incremental merge.

Reviewed the exact isolated checkout at `/Users/johnnyamancio/orca/workspaces/kilocode/review-pr-13513-reports`. Read root `AGENTS.md`, `REVIEW.md`, CLI/package test instructions, merge-minimization guidance, and upstream merge documentation; loaded `kilo-steer`, `kilo-config`, and merge-review guidance. Traced actual runtime sources rather than classifying every `opencode` string as a configuration read.

Compared actual base → HEAD, pinned main → HEAD, pristine upstream v1.18.18 → v1.18.20, upstream v1.18.20 → HEAD, and both HEAD parents → HEAD. Checked config selectors, global/project/home/worktree lookup, commands/agents/modes/plugins/skills, instructions, environment flags, TUI migration, the config-source listing, and built-in skill registration. Used real Config/Skill services with disposable files for bounded runtime checks; auth/account/NPM were fixture dependencies, and host MDM preference reads were disabled in a diagnostic preload.

| Reference | Verified commit |
|---|---|
| HEAD | `6a7d6bc002319ac2987bcde3d6c63efcafc07021` |
| Actual base / merge base | `bf1cf502a3c511e9daf6a43244568ae4e83473a8` |
| Pinned main control | `62998965e9fb0d9ed89011c62498b39801dbbb4f` |
| Upstream v1.18.18 | `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d` |
| Upstream v1.18.19 | `2b72179c663cadcb54f54d9f19221b3fb3d11fb6` |
| Upstream v1.18.20 | `7248bc1964b13fa67e601733f89ee9dc6dfa0563` |
| HEAD parent 1 | `91ca95bad927436131ea4783a470885a381ce6ad` |
| HEAD parent 2, transformed upstream | `9563af96a012effc25df5a11eaa1f7633161a742` |

The record merge `91ca95bad9` has parents actual base and pristine v1.18.20. The PR has 95 commits, two first-parent commits, and 59 changed files. Config/skill/instruction loaders did not change from the actual base or HEAD's first parent. Differences against the transformed second parent preserve Kilo's selectors and registration exclusions rather than restoring upstream candidates. Main-relative config warning/persistence changes were already in the actual base and are not changes introduced by this PR.

## Findings

No confirmed finding introduced by this upstream range or its Kilo conflict resolution.

### HV-1 — P2 conditional / human policy verification: existing OpenCode MDM domain remains active

- **Location:** `packages/opencode/src/config/managed.ts:8`, `packages/opencode/src/config/managed.ts:53`, invoked by `packages/opencode/src/config/config.ts:945`. The source-list mirror is `packages/opencode/src/kilocode/config/sources.ts:258`.
- **Verification class:** static reachability verified; real managed-profile behavior deliberately not exercised. Whether the existing compatibility behavior violates the intended product policy requires human verification.
- **Provenance:** pre-existing Kilo retention of an upstream behavior, not PR-introduced. `managed.ts` is byte-identical in actual base, HEAD, and pinned main: blob `d52f7657c7820217d7ef60842463165742165737`.
- **Invariant/control:** automatic `.opencode` directory fallback is excluded, but that is not currently a blanket prohibition on every OpenCode-named config source. On macOS, the loader still checks `/Library/Managed Preferences/<user>/ai.opencode.managed.plist` and the system equivalent, converts an existing plist with `plutil`, and merges it after other config sources. Pinned main is the same-behavior provenance control; the directory-exclusion runtime tests are the distinct negative control.
- **Potential impact:** a machine with an OpenCode-managed profile can have its Kilo settings overridden by that profile. This is conditional on such a profile existing, not an observed host failure or a claimed merge regression.
- **Fix direction:** confirm whether enterprise OpenCode-profile compatibility is intentional. If the policy forbids it, move the loader and source-list mirror to an agreed Kilo-owned managed domain in a separate change with disposable-profile tests. Do not treat this PR as having reintroduced the domain.

## Notable non-findings

### Directory fallback removal and `.kilo` priority survive

`packages/opencode/src/config/paths.ts:23` selects only the Kilo XDG root, `.kilocode`/`.kilo` project and home directories, and explicit `KILO_CONFIG_DIR`. It never adds `.opencode`. This file is byte-identical in actual base, HEAD, and pinned main: blob `5517f82a949207005b0e451a1d9370ac62e788e2`.

`packages/core/src/config.ts:143` and `packages/core/src/config.ts:182` independently retain Kilo directory discovery for the v2 service. `.kilo`/`.kilocode` target order is reversed when applied at `packages/core/src/config.ts:189`, preserving canonical `.kilo` precedence. This entire file is identical across the same three Kilo controls: blob `6c9b06d3e5990f2fd833c14457548b0388fb6b63`.

The CLI passes those directories to command, agent, mode, and file-plugin loaders at `packages/opencode/src/config/config.ts:827`, `:833`, `:840`, and `:848`. The changed plugin registry still gets external plugin origins from that merged config at `packages/opencode/src/plugin/index.ts:162` and `:191`; its only registration addition is the Cerebras chat-parameter hook, not another discovery root. Bounded runtime checks confirmed `.opencode` contributes no config, agent, command, plugin origin, or skill, while both Kilo directory spellings still work.

### Primary-worktree fallback remains Kilo-only

`packages/opencode/src/config/config.ts:766` requests only `[".kilocode", ".kilo"]` from `primaryPaths`, inserts primary results before active-worktree directories, and marks them local. `packages/opencode/src/kilocode/primary-worktree.ts:23` walks the mirrored directory to the primary root using only the supplied names. Skills use the same Kilo names at `packages/opencode/src/skill/index.ts:245`; `.agents` and `.claude` are separate, intentionally supported external skill roots at `:213`. None of these sources changed against actual base or pinned main. Real linked-worktree fixture tests were not run because they create commits and edit fixture Git configuration; this portion is static evidence only.

### Legacy filenames are active, but were not restored here

The broader assertion that Kilo reads no OpenCode-named configuration files is not true of actual base or pinned main:

- `packages/opencode/src/config/config.ts:434` and `:438` merge `opencode.json`/`opencode.jsonc` **inside the Kilo global directory**.
- `packages/opencode/src/config/config.ts:744` retains root-level `opencode.json[c]` alongside `kilo.json[c]`.
- `packages/opencode/src/kilocode/config/config.ts:41` retains these filenames inside allowed Kilo directories and managed directories.
- `packages/opencode/src/kilocode/skills/kilo-config.md:338`–`:346` explicitly documents legacy filenames while excluding `.opencode` directories.

A bounded runtime control confirmed root `opencode.json` still overrides root `kilo.json` for the same model field. This is existing lookup order, not a newly reordered `.kilo` lookup. A separate poisoned sibling XDG `opencode/opencode.json` was ignored. No filename-compatibility removal is proposed as a merge fix.

### Changed `customize-opencode` documentation is not a registered Kilo builtin

The only change at `packages/core/src/plugin/skill/customize-opencode.md:43` adds `~/.config/opencode/opencode.jsonc` to an upstream documentation row. Upstream history contains `62387f39d4` (`fix(skills): Update global config path in documentation (#42337)`) and generated adjustment `ab7cbc808f` for this file.

The body is imported by `packages/core/src/plugin/skill.ts:9`, but Kilo's production registration deliberately omits that plugin at `packages/core/src/plugin/internal.ts:112`. Repository-wide caller search found only the direct core unit test invoking `SkillPlugin.Plugin`; the config-skill plugin is a different module. The production exclusion is unchanged from actual base and pinned main.

The CLI seeds `kilo-config` from `packages/opencode/src/kilocode/skills/builtin.ts:14` through `packages/opencode/src/skill/index.ts:301`. A bounded real Skill-service check returned `kilo-config` and not `customize-opencode`. System skill context uses this registry at `packages/opencode/src/session/system.ts:159`; its environment context still directs creation into `.kilo`, explicitly not `.kilocode` or `.opencode`, at `packages/opencode/src/kilocode/system-prompt.ts:29`. No built-in documentation regression was demonstrated.

### Instructions, flags, migration, and path-like names

- `packages/opencode/src/session/instruction.ts:62` still prefers explicit `KILO_CONFIG_DIR/AGENTS.md`, then the Kilo global root, with the separately supported Claude fallback. Project `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md` handling and provenance restrictions are unchanged. Three instruction-profile precedence tests passed.
- `packages/core/src/flag/flag.ts:45`, `:131`, and `:140` use `KILO_CONFIG`, `KILO_DISABLE_PROJECT_CONFIG`, and `KILO_CONFIG_DIR`; no `OPENCODE_CONFIG` alias was added. The bounded disable-project check passed.
- `packages/opencode/src/config/tui.ts:192`/`:223` reuse/filter Kilo directories. Despite its old helper name, `packages/opencode/src/config/tui-migrate.ts:126` discovers `kilo.json[c]`, not implicit OpenCode config files. Neither path changed in this PR.
- `packages/opencode/src/kilocode/config/config.ts:643` checks existence of leftover OpenCode directories for a migration notice; it does not parse or merge their content. A bounded test distinguished detection from loading.
- The changed `opencode-go` provider identifier in `packages/opencode/src/tool/registry.ts:87`, the account console URL, provider SDK imports, and `.opencode-version` download-cache/version markers are not restored local config discovery. Existing well-known remote config is auth-selected, not a filesystem fallback.

## Command outputs and validation

All terminal commands had the designated review checkout or its `packages/opencode` directory as `workdir`. No dependency installation was performed by this reviewer.

| Command/check | Result |
|---|---|
| `git rev-parse HEAD` and `git merge-base bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD` | Exact supplied HEAD and actual base |
| `git diff --stat bf1cf502a3c511e9daf6a43244568ae4e83473a8 HEAD` | 59 files, 1524 insertions, 647 deletions |
| `git rev-list --count bf1cf502a3c511e9daf6a43244568ae4e83473a8..HEAD` | `95` |
| `git log --first-parent --oneline bf1cf502a3c511e9daf6a43244568ae4e83473a8..HEAD` | `6a7d6bc002 resolve merge conflicts`; `91ca95bad9 merge: record upstream v1.18.20` |
| Scoped upstream .18 → .20 loader diff | No changes to config selectors, core global/flags/FS walker, instruction loader, or builtin registration |
| Scoped actual-base/first-parent → HEAD loader diff | Empty |
| `git diff --check` | Passed; no tracked source changes |

Final test runs used Bun `1.3.14`, empty inherited environment except PATH, checkout-local HOME/TMPDIR, canonical `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG_NOSYSTEM=1`, and `KILO_DISABLE_MODELS_FETCH=1 KILO_DISABLE_DEFAULT_PLUGINS=1 KILO_DISABLE_LSP_DOWNLOAD=1`. The package test preload supplied disposable XDG roots and an in-memory database. A diagnostic preload replaced only host `readManagedPreferences()` with an empty result.

From `packages/opencode`, with that environment:

```text
bun test --preload ../../.review-config-r6/preload.ts ../../.review-config-r6/bounded.test.ts
6 pass, 0 fail, 23 expect() calls; 1.384s

bun test --preload ../../.review-config-r6/preload.ts ./test/kilocode/instruction.test.ts ./test/kilocode/config/variable.test.ts
16 pass, 2 skip, 0 fail, 19 expect() calls; 2.39s
```

The six bounded checks exercised actual runtime code with an explicit fixture-local `InstanceRef.worktree`: project config/agent/command/plugin/skill exclusions and positive Kilo controls; home directory exclusion plus explicit-profile ordering; legacy root filename compatibility; global OpenCode sibling exclusion; project-config disable; and migration detection without loading. Auth/account and NPM used existing test fixtures, avoiding credentials and package installation. Diagnostic files were removed after verification.

Two earlier attempts are not counted as successful isolated validation:

1. Existing `test/kilocode/config/config.test.ts`, filtered to `project config directory precedence|opencode config migration notice`: **3 pass, 3 fail, 46 filtered out**. With TMPDIR inside this checkout, notice tests walking without a worktree stop detected the checkout's own `.opencode` directory. More importantly, the noncanonical Git-ceiling value did not isolate the fixture: loader logs showed attempted config reads under the primary checkout at `/Users/johnnyamancio/Workspace/kilo_workspace/kilocode/`. This run is discarded as contaminated. It is not evidence that the PR reintroduced OpenCode config loading.
2. First bounded-harness invocation: **0 pass, 1 import error** because the diagnostic used a relative Effect package-directory import. Corrected to its existing `dist/index.js`; the subsequent four-check run and final six-check run passed.

## Limitations and cleanup

- Configuration-discovery verdict only, not the overall seven-lens PR verdict. No live model calls, provider credential integration, Windows execution, real enterprise MDM profiles, or full linked-worktree integration run. The two skipped substitution tests are Linux-specific `/proc` protections.
- Pinned local refs and parent graph were verified; this reviewer did not refetch tags, inspect live GitHub checks, or re-query the remote PR. HEAD remained `6a7d6bc002319ac2987bcde3d6c63efcafc07021` at completion.
- The first fixture run violated the intended runtime isolation boundary by attempting primary-checkout config reads. No credential values were printed, but this report does **not** claim that the entire review avoided all external config access. No subsequent external inspection/repair was attempted; corrected bounded runs constrained the config context and asserted fixture-local discovery paths. The initial run's possible incidental config-setup effects outside the checkout were not independently audited.
- No source edits, commits, pushes, GitHub changes, branch switches, or Git configuration commands were made by this reviewer. No fixture tests that deliberately create commits or edit Git configuration were run. Temporary `.review-config-r6` diagnostics and test state were removed; final tracked `git diff` was empty. Other reviewers' untracked reports were left untouched.
- Lint/typecheck and broad suites were not duplicated for this report-only review; semantic targeted checks are reported above. Main-relative warning/persistence changes and the existing MDM policy question require their own provenance/scope decisions, not fixes attributed to this incremental merge.
