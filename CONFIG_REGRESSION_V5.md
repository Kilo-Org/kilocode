# Config Regression Review V5 — upstream opencode v1.18.13 merge (round 5)

- **Reviewed HEAD:** `4bb1c2a45b` (= worktree `HEAD~4`; the 4 commits above it are report-only `.md` additions — verified `git diff 4bb1c2a45b HEAD -- packages/ script/ .github/` is empty, so all line numbers below are at `4bb1c2a45b` and were read from the worktree files directly)
- **Round 1:** `CONFIG_REGRESSION.md` at `cce22e608f`, verdict: **0 findings**
- **Round 2:** `CONFIG_REGRESSION_V2.md` at `37a5cbf5db`, verdict: **0 findings**
- **Round 3:** `CONFIG_REGRESSION_V3.md` at `b6505b164b`, verdict: **0 findings**
- **Round 4:** `CONFIG_REGRESSION_V4.md` at `b793883de6`, verdict: **0 findings** + 1 flagged observation (models.dev URL flip)
- **Delta under scrutiny:** `git diff b793883de6..4bb1c2a45b` — single commit `4bb1c2a45b` "fix(core): address round 4 review findings", 5 files (+24/−14): `packages/core/src/models-dev.ts`, `packages/opencode/src/config/config.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/opencode/script/kilocode/test-cli.ts`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`
- **Full PR diff:** `git diff 4f59fcb666...4bb1c2a45b` (PR base `4f59fcb666`; upstream v1.18.13 = `a105350812`)
- **Question (unchanged):** does this PR (re)introduce fallback logic for `opencode` config files/dirs, or break `.kilo`-only config lookup?

## Methodology

1. Read all four prior reports; re-verified every structural claim against `4bb1c2a45b` by direct file reads (line numbers below are at `4bb1c2a45b`).
2. Diffed the round-4→5 delta (`b793883de6..4bb1c2a45b`, 5 files) in full; classified each file for config-path relevance.
3. Re-generated the full PR diff for the two config-relevant touched files (`config/config.ts`, `core/src/models-dev.ts`) and checked every hunk.
4. Re-confirmed the structural invariants in place: `Global.Path`, `ConfigPaths`, managed dirs, migration-notice shim, overlay/writer targets, sandbox live-settings chain persistence roots and env deny list.
5. Fresh whole-tree sweep: the prescribed `grep -rn "opencode.json\|\.opencode\|config/opencode\|OPENCODE_CONFIG"` over `packages/opencode/src`, `packages/core/src`, `packages/kilo-vscode/src` (`*.ts`; **60 hits in 30 files**) — every hit classified against the round-4 table, and every containing file checked against the full PR diff (`git diff 4f59fcb666...4bb1c2a45b -- <path>`).
6. Env-var sweep: `OPENCODE_CONFIG`, `OPENCODE_MODELS_URL`, `xdgConfig*opencode` — **0 hits** in all three runtime trees (explicit `wc -l` count).
7. Ran the config-related tests as empirical evidence (first round in this series to do so): `bun test ./test/kilocode/config/ ./test/kilocode/server/config-overlay.test.ts ./test/kilocode/tool/shell-env.test.ts` from `packages/opencode/`.

## Prior-verdict re-confirmation

**Confirmed — the clean verdict still holds at `4bb1c2a45b`.** Every round-1…4 structural claim re-verified in place:

- `packages/core/src/global.ts:12` — `const app = "kilo"` (`kilocode_change`); `Global.Path.config` overridable only via `KILO_CONFIG_DIR` (line 80). File untouched by PR diff and delta.
- `packages/opencode/src/config/paths.ts:29,35` — `ConfigPaths.directories` targets `[".kilocode", ".kilo"]` only (`kilocode_change`), plus `Global.Path.config` (line 26) and optional `KILO_CONFIG_DIR` (line 39). File untouched by PR diff and delta.
- `packages/opencode/src/config/managed.ts:23-27` — managed dirs `/Library/Application Support/kilo`, `%ProgramData%\kilo`, `/etc/kilo` (`kilocode_change`-marked). Untouched by PR diff and delta.
- Migration-notice shim intact: `detectOpencodeConfig()` / `opencodeConfigNotification()` at `packages/opencode/src/kilocode/config/config.ts:562,591` (warn-only: "Kilo no longer falls back to opencode configuration", line 599). Untouched by PR diff and delta.
- `packages/opencode/src/config/config.ts` (the one PR-touched structural file):
  - Full PR diff (`git diff 4f59fcb666...4bb1c2a45b -- packages/opencode/src/config/config.ts`) contains **only `ensureGitignore` hunks** — two hunks at lines 434-437 and 451-458, both error-handling broadening inside `kilocode_change` markers (details in the next section). **No path, candidate-list, ordering, or discovery change anywhere in the file.**
  - `globalConfigFile()` (`config.ts:197-207`): candidates `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"]` under `Global.Path.config` — kilo first, `kilocode_change`-marked, outside all PR hunks.
  - Global layering (`config.ts:380-386`): `config.json → kilo.json → kilo.jsonc → opencode.json → opencode.jsonc` — identical to base, outside all PR hunks.
  - Project discovery (`config.ts:667`) loops `["kilo", "opencode"]` via `ConfigPaths.files` — kilo first, pre-existing compat, outside all PR hunks.
  - Remote config well-known endpoint `${url}/.well-known/opencode` (`config.ts:584`, shifted from 592 by the fix's net −8 lines) — pre-existing upstream protocol name, outside all PR hunks.
- Sandbox live-settings chain (fully traced in V4): every file in the chain — `kilocode/config/overlay.ts`, `kilocode/config/writer.ts`, `kilocode/sandbox/policy.ts`, `store.ts`, `preference.ts`, `config.ts`, `kilocode/server/httpapi/handlers/config-console.ts` — verified **untouched by the full PR diff** at the new head (all 7 `git diff 4f59fcb666...4bb1c2a45b -- <path>` empty) and untouched by the round-5 delta. Spot re-confirmations in place: `store.ts:19` root = `kilo-sandbox-policy` sibling of the kilo state dir; `preference.ts:8` root = `kilo-sandbox-preference` sibling; `policy.ts:263` env deny list = `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, `KILO_CONFIG_DIR`, `KILO_SERVER_PASSWORD`, `KILO_SERVER_USERNAME` (kilo-only). Chain remains kilo-only end to end.

## Delta scrutiny: the fix commit `4bb1c2a45b` (task items 1-2)

### 1. `packages/opencode/src/config/config.ts` (−11/+3) — EROFS/error-handling fix only

Exactly two hunks, both inside `ensureGitignore` (`config.ts:434-459`):

- **Hunk A (`config.ts:435-437`):** the `fs.ensureDir(dir)` guard changed from
  `Effect.catchReason("PlatformError", "PermissionDenied", …)` + `Effect.catchReason("PlatformError", "NotFound", …)`
  to `Effect.catchTag("PlatformError", () => Effect.void)`. Comment updated: "…must not abort tools after entering filesystem confinement **or read-only locations**".
- **Hunk B (`config.ts:457`):** the `.gitignore` `writeFileString` guard changed from
  `Effect.catchIf((e) => e.reason._tag === "PermissionDenied" || e.reason._tag === "NotFound")`
  to `Effect.catchTag("PlatformError", () => Effect.void)` with a `kilocode_change` comment.

**Verdict:** pure error-handling broadening. `catchTag("PlatformError")` is a strict superset of the previous two-reason filter — every failure the old code swallowed is still swallowed, and errno-derived failures with other reason tags (the round-4 EROFS read-only-filesystem case) are now also swallowed. The function's inputs, the directory it operates on, all candidate lists, all ordering, and all discovery logic are byte-identical to round 4. `.kilo`-only behavior survives intact (re-verified lists above). No new finding.

### 2. `packages/core/src/models-dev.ts` — V4 observation RESOLVED

- Delta change: `Flag.KILO_MODELS_URL || "https://models.opencode.ai"` → `Flag.KILO_MODELS_URL || "https://models.dev" // kilocode_change`; cache-file guard `source === "https://models.opencode.ai"` → `source === "https://models.dev" // kilocode_change` (`models-dev.ts:169-173`).
- Full PR diff at the new head now shows the `source` and `filepath` lines as **content-identical to the PR base `4f59fcb666`** — the only remaining delta on those lines is the added `kilocode_change` markers. The round-4 flagged flip `models.dev → models.opencode.ai` is gone.
- Endpoint-only file: the URL feeds the model catalog fetch and the cache filename under `Global.Path.cache`; it touches no config discovery, no config-path logic, and remains `KILO_MODELS_URL`-overridable. One correct behavior note: with the fix, a user setting `KILO_MODELS_URL=https://models.opencode.ai` explicitly gets a hashed cache file (`models-<hash>.json`) rather than `models.json` — same as the base branch's semantics for non-default URLs.
- The file's other PR hunks (`InterleavedField` schema, `interleaved` widened to `Schema.Boolean`, `reasoning_options` marker cleanup) are upstream v1.18.13 carries / marker hygiene, not config-path.

### Remaining delta files (config-path relevance: none)

| File | What it does | Config-path verdict |
|---|---|---|
| `packages/kilo-vscode/src/agent-manager/GitOps.ts` | `nonInteractiveEnv()` additionally deletes `EDITOR`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `PAGER`, `GIT_PAGER`, `GIT_SSH`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG`, `GIT_PROXY_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_TEMPLATE_DIR` from spawned-git env | Hermeticity hardening for agent-manager git subprocesses. The scrubbed `GIT_CONFIG*` variables point at **git's own** config files, not kilo/opencode config; removing them makes git ops *less* environment-dependent. No kilo/opencode config path is read, written, or reordered. |
| `packages/opencode/script/kilocode/test-cli.ts` | Empty `catch {}` on fingerprint-cache read now logs `console.warn("[test-cli] failed to read fingerprint cache:", err)` | Test tooling only (AGENTS.md no-empty-catch compliance). Not shipped runtime config. |
| `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` | Restores two upstream absence assertions (`*` marker lines) wrapped in `kilocode_change` markers | Test-only. No config access. |

## New findings

**None — 0 config regressions at `4bb1c2a45b`**, same as rounds 1-4.

**Round-4 observation status:** the flagged `models.dev → models.opencode.ai` flip is **resolved** (see delta scrutiny item 2); the merged result now keeps the base branch's `models.dev` default and adds the missing `kilocode_change` markers. No open observations remain.

## Notable non-findings (verified this round)

| Location | What it is | Verdict |
|---|---|---|
| Fresh sweep: 60 hits in 30 files (round 4: 62 hits in 31 files) | Same prescribed pattern over the same three TS trees | The 2-hit/1-file reduction is fully explained: `packages/core/src/models-dev.ts` no longer matches — its two `.opencode`-token lines were the `models.opencode.ai` URLs removed by the fix commit (verified: zero `models.opencode.ai` hits remain in the file). Every other file on the round-4 list re-appears with the same classified hits. |
| Sweep-hit files touched by the full PR diff | Exactly 2 of 30: `config/config.ts`, `provider/provider.ts` (round 4 had 3; `models-dev.ts` dropped out of the sweep set) | `config.ts`: hunks verified above — token lines 199, 385-386, 584, 667 all outside the ensureGitignore hunks. `provider.ts`: PR hunks (`@@ -48`, `-224`, `-235`, `-296`, `-304`, `-918`, `-995`, `-1104`, `-1269`, `-1295`, `-1318`, `-1500`, `-1526`, `-1538`, `-1674`, `-1811`, `-2009`) do not cover the line-408 comment "options.region from opencode.json provider config". |
| Pre-existing compat shims (all verified untouched by the full PR diff at the new head — `git diff 4f59fcb666...4bb1c2a45b -- <path>` empty for each) | `kilocode/config/sources.ts:60,125,258-259` (provenance lists + managed plist), `kilocode/config/global-stamp.ts:6`, `kilocode/config/config.ts` (file-name constants + migration shim), `kilocode/config/overlay.ts:84,150` (kilo-first candidate lists), `core/src/config.ts:143` (`kilocode_change` names list), `config/tui-migrate.ts:26` + `config/tui.ts:118` (one-time tui-key migration), `cli/cmd/mcp.ts:401-414` (`kilo mcp add` candidates), `kilocode/permission/config-paths.ts:23` (edit-permission classification), `kilocode/agent/index.ts:207` + `agent/agent.ts:220` + `core/src/plugin/agent.ts:146` (`.opencode/plans/*.md` allow rule), `installation/index.ts:189` + `cli/cmd/uninstall.ts:212-304` (old `.opencode/bin` cleanup), `skill/discovery.ts:112,132` + `core/src/skill/discovery.ts:129,180` (`.opencode-version` staging stamp), `core/src/plugin/skill.ts:23` (upstream config-authoring skill prompt), `kilocode/system-prompt.ts:29` (prompt *enforcing* `.kilo/`-only), `kilo-vscode/src/kilo-provider/config-file.ts:34-96` (LEGACY viewer listing), `kilo-vscode/src/services/marketplace/relevance.ts:4` (search exclude glob), `config/managed.ts:8` (`ai.opencode.managed` plist domain), `cli/cmd/account.ts:18`, `server/shared/ui.ts:77`, `plugin/shared.ts:200`, `kilocode/provider/metadata.ts:11`, `core/src/plugin/provider/opencode.ts`, `core/src/catalog.ts:244`, `kilocode/server/httpapi/handlers/kilo-gateway.ts:328` (migration-shim call site) | All pre-existing intentional compat/migration/display/branding; none is a runtime fallback introduced by this PR. |
| Env-var surface | `OPENCODE_CONFIG*` / `OPENCODE_MODELS_URL` / `xdgConfig*opencode`: **0 hits** (explicit count) in `packages/opencode/src`, `packages/core/src`, `packages/kilo-vscode/src`; the round-5 delta only removes more non-kilo variables (`GIT_*`) from spawned-process env | Merge did not resurrect upstream env-var fallbacks. |
| `GitOps.ts` `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` deletion | Could be misread as config-path manipulation | It severs **git's** global/system config inheritance for agent-manager subprocesses (anti-interference hardening). It does not consult, mirror, or alter any kilo/opencode config discovery path. |

## Test evidence (run this round)

From `packages/opencode/` at the reviewed head (worktree tree = `4bb1c2a45b` for `packages/`):

```
$ bun test ./test/kilocode/config/ ./test/kilocode/server/config-overlay.test.ts ./test/kilocode/tool/shell-env.test.ts
 113 pass
 2 skip
 0 fail
 254 expect() calls
Ran 115 tests across 13 files. [116.64s]

$ bun test ./test/kilocode/tool/shell-env.test.ts
 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file. [4.95s]
```

- `shell-env.test.ts` — the test failing pre-fix — **now passes** (1/1).
- The kilocode config suite (12 files incl. `config.test.ts`, `console-ui.test.ts`, `variable.test.ts`, …) and `config-overlay.test.ts` all pass; the overlay suite's live-settings tests (writing `kilo.json` into a tmpdir global config) exercise the kilo-path write chain empirically. Test logs show the loader probing kilo-first candidates in tmpdirs (`…/.kilo/opencode.jsonc` appears only as a *probed candidate* inside a `.kilo` dir in the pre-existing file-compat list — consistent with the retained file-fallback non-finding, not directory discovery).

## Limitations

- The EROFS fix is verified by construction: `Effect.catchTag("PlatformError", …)` is a strict superset of the previous `catchReason(…, "PermissionDenied")`/`catchReason(…, "NotFound")` pair, so any fs syscall failure surfaced by effect's FileSystem layer (EROFS included) is now swallowed. I did not empirically confirm the exact `reason._tag` EROFS maps to in the installed `@effect/platform` (bun store layout did not yield the mapping to a targeted grep within timeout), and I did not reproduce an actual read-only-filesystem run.
- Tests were run only for the three prescribed config-related targets; the full `bun test` suite, `typecheck`, and `script/check-opencode-annotations.ts --worktree` were not run this round (marker compliance of the fix commit's new/changed markers — `models-dev.ts` two lines, `diff-viewer-file-tree.test.tsx` block, config.ts comment updates — was verified by eye on the diff; note the fix's markers sit in shared upstream files where markers are required, and all are present).
- The pre-existing tension noted in rounds 1-4 stands unchanged: `opencode.json(c)` *file* fallbacks are retained in `config.ts` while the migration notice says Kilo "no longer falls back" (about `.opencode` *directories*). Predates the PR; nothing in the round-5 fix altered it.
- The fix commit's non-config files (`GitOps.ts`, `test-cli.ts`, `diff-viewer-file-tree.test.tsx`) were reviewed for config-path relevance only; their primary behavior (git-env hermeticity, cache-read logging, TUI assertions) is covered by the other round-5 review tracks.
