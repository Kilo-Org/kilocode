# Broken Pipeline Chains Review V5 — upstream v1.18.13 merge (PR head 4bb1c2a45b)

## Scope and methodology

ROUND 5 of the broken-pipeline-chains review. Round 4 (`BROKEN_PIPELINE_CHAINS_V4.md`) reviewed `b793883de6`. This round re-reviews at `4bb1c2a45b` (PR base `4f59fcb666`, upstream tag `a105350812`); the delta over round 4 is the single round-4-fix commit `4bb1c2a45b` touching 5 files (`packages/core/src/models-dev.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/opencode/script/kilocode/test-cli.ts`, `packages/opencode/src/config/config.ts`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`; +24/−14). The top 4 commits on the branch are report-only. Work performed:

1. Verified the round-4-fix commit against V4 findings 3 and 4 by reading the fixed code at head, re-reading the actual vulnerability-check implementation in `node_modules` (`@simple-git/argv-parser@1.1.1` dist, `simple-git@3.36.0`), and running targeted tests as empirical evidence — including new contaminated-shell variants that export each newly stripped (and each remaining unstripped) env var.
2. Traced the `models-dev.ts` catalog-default chain end to end (flag definition, runtime consumers, extension spawn env, cache naming, build tooling, upstream/base comparison) and discovered the commit fixes one instance of a three-instance merge-revert class; swept the full PR diff for further instances of that class (Kilo-branded lines removed / opencode-branded lines added).
3. Re-verified every carried finding at the new head with file:line evidence (the delta's 5-file stat already proves most are untouched; contents spot-checked regardless).
4. Fresh pass over the delta's `kilocode_change` hunks and the full-PR URL/branding sweep; attribution experiment for a newly observed test failure (source-identical tree copy outside the repo context) to distinguish delta-caused from environmental.

## Round-4 finding verification

### Finding 3 — residual simple-git-flagged env vars — FIXED for the stripped set, residual gap remains for `GIT_EXEC_PATH`/`PREFIX`

- The fix adds 12 deletions to `nonInteractiveEnv()` (`packages/kilo-vscode/src/agent-manager/GitOps.ts:88-99`): `EDITOR`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `PAGER`, `GIT_PAGER`, `GIT_SSH`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG`, `GIT_PROXY_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_TEMPLATE_DIR`. This covers V4's "at minimum" list in full.
- Re-verified against the actual guard: `@simple-git/argv-parser@1.1.1` `dist/index.mjs` `parseEnv` normalizes env keys via `toLowerCase().trim()`, keeps any key in its `y` table plus anything starting with `git`, and flags table entries as vulnerabilities: `editor`, `git_askpass`, `git_config_global`, `git_config_system`, `git_config_count`, `git_config`, `git_editor`, `git_exec_path`, `git_external_diff`, `git_pager`, `git_proxy_command`, `git_template_dir`, `git_sequence_editor`, `git_ssh`, `git_ssh_command`, `pager`, `prefix`, `ssh_askpass` (plus the `git_config_key_*`/`git_config_value_*` pairs consumed through `git_config_count`). After the fix, every flagged var is stripped except `git_exec_path` and `prefix`; `git_ssh_command` remains deliberately handled only via `allowUnsafeSshCommand: isKiloOwnedSshCommand(env)` (`WorktreeManager.ts:849-852`, unchanged), so a user-supplied value still fails closed — a documented security choice.
- **Empirical closure proof:** in this shell (which exports the original round-3 contamination `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*`/`GIT_ASKPASS`/`SSH_ASKPASS`), `tests/unit/worktree-manager.test.ts` passes 88/88 with 11 of the 12 newly stripped vars additionally exported (`EDITOR=vim PAGER=less GIT_EDITOR=nano GIT_PAGER=less GIT_SEQUENCE_EDITOR=nano GIT_SSH=ssh GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_PROXY_COMMAND=true GIT_EXTERNAL_DIFF=true GIT_TEMPLATE_DIR=<empty dir>`). `GIT_CONFIG` itself could not be included: any value redirects the test harness's own raw-`git config user.email` repo setup (harness limitation, not product code — the harness spawns git with the inherited env, while the product path sanitizes).
- **Empirical residual proof:** exporting `PREFIX=/tmp` alone, or `GIT_EXEC_PATH=$(git --exec-path)` alone (a harmless, git-functional value), each makes the round-3 sentinel test `resolveStartPoint > returns bare branch + remote when remote exists` fail with `Expected "remote" / Received "local-tracking"` — i.e. simple-git's `vulnerabilityCheck` still throws on the fetch and `resolveStartPoint` still silently falls back to the stale remote-tracking ref. Both vars map to `allowUnsafeConfigPaths` in the guard's table and are unstripped at head.
- **Impact of the residual:** low. Both vars are uncommon in a desktop extension-host environment (`GIT_EXEC_PATH` is set by git itself for hook/external-command contexts; `PREFIX` is a build-toolchain var), far less common than `EDITOR`/`PAGER`. The failure mode is unchanged from V4: graceful but silent stale-ref fallback while online.
- **Human verification:** decide whether to also strip `GIT_EXEC_PATH` and `PREFIX` in `nonInteractiveEnv()` (both are benign for `fetch`), closing the guard's flagged set completely. Reproduce: `PREFIX=/tmp bun test tests/unit/worktree-manager.test.ts` from `packages/kilo-vscode/` → 87/88 with the stale-ref fallback.

### Finding 4 — `ensureGitignore` does not catch `EROFS` — FIXED

- Both the mkdir and the `.gitignore` write now swallow every effect `PlatformError` regardless of reason: `fs.ensureDir(dir).pipe(Effect.catchTag("PlatformError", () => Effect.void))` (`packages/opencode/src/config/config.ts:436`) and the same `catchTag` on the write (`config.ts:457`). EROFS surfaces from effect's FileSystem as `PlatformError` with reason `"Unknown"`, which the old reason-scoped catches (`PermissionDenied`/`NotFound` only) missed; the tag-scoped catch covers it.
- **Empirical closure proof:** `bun test ./test/kilocode/tool/shell-env.test.ts` (sets `KILO_CONFIG_DIR=/secret/config`) now passes 1/1 in this machine's EROFS sandbox; in V4 the identical run failed during config layer build (`FileSystem.makeDirectory /secret/config`, reason `"Unknown"`, defecting through `Effect.orDie`).
- Chain completeness re-checked: the directory loop (`config.ts:706-760`) has no other uncontained write — the background `npmSvc.install(dir, …)` is wrapped in `Effect.exit` + warning tap (`config.ts:743-759`), so an EROFS there degrades to a logged warning, not a defect; `existsSafe` can't defect (`fs-util.ts:59-61`, `orElseSucceed(false)`).
- Trade-off note: the catch is now deliberately broad (also swallows e.g. `BadArgument`). Semantically consistent with the path's purpose ("optional config setup must not abort config load"), and both sites carry updated `kilocode_change` markers. No finding.

### Finding 1 (locale markers stripped in 8 locales) — STILL OPEN (unchanged)

- The delta touches no `packages/ui/src/i18n/` file. Spot check at head: `packages/ui/src/i18n/fi.ts` contains zero `kilocode_change` markers and its `dialog.usageExceeded.freeTier.description` (`fi.ts:71-72`) still says "Kilo Go" where upstream `a105350812` says "OpenCode Go". The 12-marked/8-unmarked inconsistency stands. Human verification unchanged (confirm intentional phase-out or restore markers in az/fi/hi/id/pa/sv/ur/vi).

### Finding 2 (orchestration `stats()`/`prs()` drop the request directory) — STILL OPEN (unchanged)

- `orchestration-setup.ts:42-43` still reads `stats: () => deps.getStats()`, `prs: () => deps.getPrs()` — the directory parameter is still discarded, and `getStats` remains the active project's singleton poller snapshot. The delta's `GitOps.ts` change is unrelated to orchestration (no orchestration file is in the 5-file stat). V4's graceful-degradation assessment (collision-proof `wt-<ms>-<counter>` IDs → annotation miss, not corruption) still holds. Human verification unchanged.

### Carried findings (rounds 1-3) — all unchanged at this head

The delta's 5 files do not intersect any carried-finding file (`git diff b793883de6..4bb1c2a45b --stat`), so these are open/closed exactly as in V4; contents spot-checked at head:

- **(d) `Schema.is(Model)` silent-drop in `toPublicInfo`** — STILL OPEN: `packages/opencode/src/provider/provider.ts:1128` filter intact and identical. Human verification unchanged (diff `/provider` output pre/post merge for custom/gateway/copilot models).
- **(e) session-list `?directory=` reroute** — UNCHANGED, statically wired (`handlers/session.ts:73` region identical); runtime confirmation on symlinked/nested worktrees still outstanding.
- **(f) `promptCacheKey` narrowing for `openai`-provider models on `@ai-sdk/openai-compatible`** — STILL OPEN: `provider/transform.ts:1558-1571` identical, marker intact. Awaiting intent confirmation.
- **(g) modal failure fallback round-trip** — STILL OPEN (low): `plugin/modal/modal.ts` and the `provider.ts:1455-1467` hook merge untouched; only materializes with (d).
- **(h) `ensureDir` lost exists-as-file recheck** — STILL OPEN: `packages/kilo-sandbox/src/filesystem.ts:15-22` (`ensureDirectory` catches only `AlreadyExists`) and the sole call site `packages/core/src/fs-util.ts:117-119` are untouched. Explicitly checked against the delta: the `config.ts` fix modified `ensureGitignore`'s error handling only; it did not touch `ensureDirectory`/`FSUtil.ensureDir`. These are distinct chains and (h) remains open.

## New findings (round 5)

### 1. The models.dev→models.opencode.ai merge revert has two more instances the fix did not restore

- **Chain:** build-time provider-icon sync (`packages/ui/vite.config.ts` `fetchProviderIcons`, gated behind `KILO_FETCH_PROVIDER_ICONS`) and the LLM recording cost report (`packages/llm/script/recording-cost-report.ts`) → both fetch `${url}/api.json` from the models catalog host → same catalog the runtime now reads from `https://models.dev` again after `4bb1c2a45b`.
- **Broken link:** the merge silently reverted all three of Kilo's `models.dev` defaults to upstream's `models.opencode.ai` (verified: PR base `4f59fcb666` has `models.dev` in all three files; upstream `a105350812` has `models.opencode.ai`; the full-PR diff shows Kilo's lines removed). The round-4 fix restored only the runtime instance (`packages/core/src/models-dev.ts:169,172`, now correctly carrying `kilocode_change` markers). Still reverted and unmarked at head:
  - `packages/ui/vite.config.ts:50` — `const url = process.env.KILO_MODELS_URL || "https://models.opencode.ai"` (base had `models.dev`).
  - `packages/llm/script/recording-cost-report.ts:5` — `const MODELS_DEV_URL = "https://models.opencode.ai/api.json"` (base had `models.dev`).
- **Impact:** low. Both are dev/build tooling: the vite plugin only runs when `KILO_FETCH_PROVIDER_ICONS` is set during a UI build, and the cost report is a manual script. The practical consequence is catalog drift between tooling and runtime (icon set / pricing source synced from opencode's mirror while the CLI catalog comes from models.dev); response shapes are the same (`/api.json`, `/logos/<provider>.svg`), so nothing crashes. The unmarked divergence also repeats the merge-hygiene risk: nothing marks these lines as intentionally Kilo's if the team restores them.
- **Human verification:** confirm the restore in `models-dev.ts` was meant to cover all three instances; if yes, set both remaining files back to `https://models.dev` and add `kilocode_change` markers (both are shared upstream files — `recording-cost-report.ts` exists at `a105350812`, and `vite.config.ts` is upstream-owned). Evidence: `git diff 4f59fcb666...4bb1c2a45b -- packages/ui/vite.config.ts packages/llm/script/recording-cost-report.ts`.
- Note: a fourth hit, `packages/opencode/.artifacts/test-cli-*/src/storage/cli.js`, is a gitignored local build artifact embedding the stale reverted value — not shipped, not a finding.

### 2. `kilocode_change` markers placed around lines byte-identical to upstream in the TUI diff-viewer test

- **Chain:** `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` (shared upstream test file) → marker-based merge hygiene → next upstream merge.
- **Weak link:** the fix restores the two upstream absence assertions (`expect(focused.some((line) => line.includes("*"))).toBe(false)` and the `unfocused` twin) but wraps them in `// kilocode_change start` / `end` (`diff-viewer-file-tree.test.tsx:112-115`). The enclosed lines are byte-identical to upstream `a105350812` (and were present at PR base `4f59fcb666` — the merge had dropped them). Markers denote divergence from upstream; marking upstream-identical lines inverts the convention and can mislead future merge tooling into treating the block as Kilo-owned. This is the mirror image of V4 finding 1 (markers removed where lines still diverge); here markers were added where lines don't diverge.
- **Impact:** hygiene only; the test itself passes (3 pass / 1 skip, see below). Belongs to the unnecessary-markers class tracked by the sibling report.
- **Human verification:** decide whether the marker is deliberate restoration documentation (to signal "these were intentionally re-added") or should be dropped to match the marker contract. If the team keeps markers on restored-but-upstream-identical lines as policy, apply that policy consistently — V4 finding 1's locales are the opposite treatment of the same situation.

## Notable non-findings (verified this round)

- **models-dev.ts runtime chain (the fixed instance) is sound:** the default is consumed through core `ModelsDev.Service.get()` by the provider catalog (`packages/opencode/src/provider/provider.ts:1393`), the `/provider` HTTP handler (`handlers/provider.ts:51`), `cli/cmd/providers.ts`, and `github.handler.ts`; the Kilo overlay layer (`opencode/src/provider/models.ts:45-46`) delegates to `core.get()` and has no independent URL. `KILO_MODELS_URL` still overrides (`flag.ts:105`, env-only); the extension does **not** set it (grep-clean over `packages/kilo-vscode/src` and `webview-ui/src`), so extension-spawned servers inherit the fixed default — restoring Kilo main's behavior. Cache naming is consistent (`source === "https://models.dev" ? "models.json" : hashed`, `models-dev.ts:170-173`); a user-pinned `KILO_MODELS_URL` gets its own hashed cache file, and the 5-minute TTL plus JSON-parse-validated `loadFromDisk` bound any cross-host cache staleness. Build tooling was already consistent: `script/generate.ts:11` defaults to `models.dev`, `script/build.ts:118` deletes the var in `smokeEnv`, and `local-bin.ts:123` only passes it through.
- **`reasoning_options` marker retirement in `models-dev.ts` is correct:** Kilo's v1.18.11 "snatched" schema block lost its markers because upstream v1.18.13 absorbed the feature — the lines no longer diverge, so unmarking is right (the opposite direction of V4 finding 1).
- **`models-api.json` fixture refresh:** the kilo-gateway provider entry (`api.kilo.ai/api/gateway`) removed in the PR diff is re-added in the same file with refreshed models plus a new tencent entry — fixture data refresh, entry retained.
- **`test-cli.ts` catch fix:** the empty catch now warns (`script/kilocode/test-cli.ts:70-72`) and falls through to a full rebuild on fingerprint-cache read failure — satisfies the no-empty-catch rule; Kilo-owned path, behavior sane.
- **`GitOps.ts` `GIT_SSH` deletion:** stripping a user-set `GIT_SSH` means background fetches ignore a custom ssh binary; acceptable for the non-interactive path and required to pass the guard. `GIT_SSH_COMMAND` semantics unchanged.
- **Guards:** `check-opencode-annotations --worktree` reports nothing to check; both package typechecks pass (see below).

## Test outputs (this head)

| Suite | Result |
|---|---|
| `packages/kilo-vscode`: `bun test tests/unit/worktree-manager.test.ts` (contaminated shell, V4 repro) | 88 pass / 0 fail |
| same, plus 11 newly stripped vars exported (`EDITOR`/`PAGER`/`GIT_EDITOR`/`GIT_PAGER`/`GIT_SEQUENCE_EDITOR`/`GIT_SSH`/`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`/`GIT_PROXY_COMMAND`/`GIT_EXTERNAL_DIFF`/`GIT_TEMPLATE_DIR`) | 88 pass / 0 fail — finding-3 closure proof |
| same, plus `PREFIX=/tmp` only | 87 pass / 1 fail — `resolveStartPoint` falls back to `local-tracking` (residual gap) |
| same, plus `GIT_EXEC_PATH=$(git --exec-path)` only | 87 pass / 1 fail — same fallback (residual gap) |
| `packages/kilo-vscode`: `bun run test:unit` (full suite, contaminated shell) | 3799 pass / 0 fail — matches V4 |
| `packages/opencode`: `bun test ./test/kilocode/tool/shell-env.test.ts` (EROFS sandbox) | 1 pass / 0 fail — finding-4 closure proof (V4: failed) |
| `packages/opencode`: `bun test ./test/kilocode/config/config.test.ts ./test/kilocode/server/config-overlay.test.ts` | 71 pass / 1 fail — see environmental note below |
| `packages/tui`: `bun test ./test/cli/tui/diff-viewer-file-tree.test.tsx` | 3 pass / 1 skip / 0 fail |
| `packages/opencode`: `bun run typecheck` (tsgo) | pass |
| `packages/kilo-vscode`: `bun run typecheck` (extension + webview) | pass |
| root: `bun run script/check-opencode-annotations.ts --worktree` | "No shared upstream source files changed — nothing to check." |

**Environmental test note (not delta-caused):** `config-overlay.test.ts > merges workflow overrides with a command body in the lower-precedence global file` fails deterministically in this review worktree (32/33 run alone; the `response.effective.command.review` lacks the just-patched `model`/`variant` while keeping the lower-precedence `template`). Attribution experiment: a source-identical copy of the repo (rsync, symlinked `node_modules`, at the same head) outside any git/repo context passes 33/33 in the same contaminated shell. Since the delta changes only code and the head code passes elsewhere, the failure is environment-dependent (repo-worktree context of the test runner's cwd), not caused by `4bb1c2a45b`; the only in-chain delta file (`config.ts`) alters error-swallow breadth on a path where no error occurs in this test. V4 measured 72/72 at `b793883de6` — its effective environment evidently differed. Human verification: confirm this test is green on CI.

## Limitations

- The `GIT_CONFIG` variant of the finding-3 proof could not be executed: any value redirects the test harness's own repo-setup `git config` writes (harness uses raw git with the inherited env), so the 12th stripped var is verified only by code inspection against the guard table, not by test.
- The `GIT_EXEC_PATH`/`PREFIX` residual's real-world reachability in an actual extension host remains inferred (how VS Code inherits a launching shell's env), not reproduced live.
- The models.dev full-PR sweep covered URL/branding revert patterns (Kilo-branded removals vs opencode-branded additions across all 422 changed files); it does not exclude other, non-URL silent reverts of unmarked Kilo customizations outside the marker-checked `packages/opencode` tree.
- Runtime verifications outstanding from earlier rounds are unchanged: finding (d)'s `/provider` before/after diff, finding (e)'s worktree scoping, grok request bodies, gateway `m4a` acceptance — all need a live environment (no outbound network here).
- kilo-jetbrains was not re-checked; the delta touched no JetBrains files.
- The config-overlay environmental failure's precise mechanism (which repo-context input changes the overlay merge) was not root-caused; attribution to environment (not delta) is proven, the trigger variable (`.git` presence vs path) was not isolated further.
