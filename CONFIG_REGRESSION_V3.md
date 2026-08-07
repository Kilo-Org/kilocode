# Config Regression Review V3 — upstream opencode v1.18.13 merge (round 3)

- **Reviewed HEAD:** `b6505b164b` (round-3 head; worktree HEAD, verified = the reviewed commit. The 2 report commits on `johnnyeric/pr-v1.18.13-review-reports` are docs-only)
- **Round 1:** `CONFIG_REGRESSION.md` at `cce22e608f`, verdict: **0 findings**
- **Round 2:** `CONFIG_REGRESSION_V2.md` at `37a5cbf5db`, verdict: **0 findings**
- **Delta under scrutiny:** `git diff 37a5cbf5db..b6505b164b` (433 files; 216 commits, dominated by the merge of latest `origin/main`)
- **Full PR diff:** `git diff 6fce4e2564...b6505b164b` (419 files; new PR base `6fce4e2564`; upstream v1.18.13 = `a105350812`)
- **Question (unchanged):** does this PR (re)introduce fallback logic for `opencode` config files/dirs, or break `.kilo`-only config lookup?

Note on scope: because the branch merged in `origin/main`, several changes named for scrutiny this round (the `privacy_mode` work, JetBrains CLI logging, Agent Manager multi-project features) entered via main and are **not** in the PR diff against the new base `6fce4e2564`. They were still reviewed here as delta changes, since they are new relative to the round-2 head.

## Methodology

1. Read both prior reports; re-verified every structural claim against `b6505b164b` by direct file reads (line numbers below are at `b6505b164b`).
2. Enumerated the delta (`37a5cbf5db..b6505b164b`, 433 files) and the full PR diff (`6fce4e2564...b6505b164b`, 419 files); filtered both for config-path-relevant files.
3. Scrutinized every config-touching file in the delta: `packages/core/src/v1/config/config.ts`, `packages/opencode/src/kilocode/config/overlay.ts`, `packages/opencode/src/kilocode/tui/config.ts`, `script/upstream/utils/config.ts`, `packages/opencode/test/kilocode/server/tui-config.test.ts`, `packages/kilo-vscode/src/kilo-provider/options.ts`, `packages/kilo-vscode/src/kilo-provider-utils.ts`, and the JetBrains CLI-resolution trio (`KiloBackendCliManager.kt`, `KiloCliDownloader.kt`, `KiloRepoCli.kt`).
4. Traced the full `privacy_mode` read/write chain from TUI to disk to confirm it uses the Kilo global config path.
5. Fresh whole-tree sweep: the prescribed `grep -rn "opencode.json\|\.opencode\|config/opencode\|OPENCODE_CONFIG"` over `packages/opencode/src`, `packages/core/src`, `packages/kilo-vscode/src`, `packages/kilo-jetbrains` (`*.ts`/`*.kt`; 67 hits) — every hit classified, and every containing file checked against both the PR diff and the round-2→3 delta to distinguish PR-introduced vs pre-existing.
6. Supplementary env-var sweep: `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `xdgConfig*opencode` — zero hits in all four trees; `packages/core/src/flag/flag.ts:45-46,140-141` exposes only `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, `KILO_CONFIG_DIR`.
7. Examined the new command-file endpoints (`packages/opencode/src/kilocode/command-files.ts` + handlers) and Agent Manager multi-project features for config discovery consulting opencode paths.

## Prior-verdict re-confirmation

**Confirmed — the clean verdict still holds at `b6505b164b`.** Every round-1/2 structural claim re-verified in place:

- `packages/core/src/global.ts:12` — `const app = "kilo"` (`kilocode_change`); XDG dirs resolve to `~/.config/kilo` etc. File untouched by PR and delta.
- `packages/opencode/src/config/paths.ts:29,35` — `ConfigPaths.directories` targets `[".kilocode", ".kilo"]` only (`kilocode_change`), plus `Global.Path.config` and optional `KILO_CONFIG_DIR`. File untouched by PR and delta.
- `packages/opencode/src/config/config.ts`:
  - Full PR diff still contains exactly **one hunk** — `ensureGitignore` (`config.ts:434-440`) wrapping upstream's `fs.ensureDir(dir)` in a `kilocode_change` block swallowing `PermissionDenied`/`NotFound`. Verified via `git diff 6fce4e2564...b6505b164b -- packages/opencode/src/config/config.ts`.
  - `globalConfigFile()` (`config.ts:197-207`): candidates `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"]` under `Global.Path.config` — kilo first, `kilocode_change`-marked, identical to base.
  - Global layering (`config.ts:380-386`): `config.json → kilo.json → kilo.jsonc → opencode.json → opencode.jsonc` — identical to base.
  - Project discovery (`config.ts:675-676`) loops `["kilo", "opencode"]` via `ConfigPaths.files` — kilo first, pre-existing compat, line untouched by the PR's single hunk.
  - Remote config well-known endpoint `${url}/.well-known/opencode` (`config.ts:592`) — pre-existing upstream protocol name, untouched line.
- `packages/opencode/src/config/managed.ts:23-27` — managed dirs `/Library/Application Support/kilo`, `%ProgramData%\kilo`, `/etc/kilo` (`kilocode_change`-marked). File untouched by PR and delta.
- Migration-notice shim intact: `detectOpencodeConfig()` / `opencodeConfigNotification()` at `packages/opencode/src/kilocode/config/config.ts:555-605` (warn-only: "Kilo no longer falls back to opencode configuration"; detects leftover `~/.config/opencode` + project `.opencode/` dirs). File untouched by PR and delta.
- Upstream TUI tips still fully inside the `/* kilocode_change hide the entire list … */` block: `packages/tui/src/feature-plugins/home/tips-view.tsx:167-293` (`TIPS` = `[` + block comment 168→292 + `]` — effectively empty; rendered list is `[...KILO_TIPS, ...TIPS, …]` at line 137). The file **is** in the PR diff against the new base, but the diff only shortens tip *text inside the comment block* and re-indents inside the `kilocode_change` wrapper — the `opencode.json` / `~/.config/opencode/tui.json` tip strings remain unreachable. Verified the closing `*/` and empty-array structure at HEAD.
- Config tests: the full PR's only config-test change remains the pure-addition `KILO_CONFIG_DIR` tests in `packages/opencode/test/config/config.test.ts` (+25/−0). The delta adds `packages/opencode/test/kilocode/server/tui-config.test.ts` (+28/−0) whose only path token asserts `.kilo` dir usage — pure addition, kilo-only.

## Delta commit scrutiny (config-relevant files only)

| File | What the delta does | Config-path verdict |
|---|---|---|
| `packages/core/src/v1/config/config.ts` | Adds optional `privacy_mode` boolean to the config schema (annotate-only) | Schema addition; no path/discovery logic. |
| `packages/opencode/src/kilocode/config/overlay.ts` | Adds `["privacy_mode"]` to `fieldPaths` (the settings-overlay display list, line 91) | Display-list entry only. The file's candidate lists are unchanged and remain kilo-first/kilo-only: `files` (line 84) `["kilo.jsonc","kilo.json","opencode.jsonc","opencode.json"]` (pre-existing file compat), `dirs` (line 85) `[".kilocode",".kilo"]` (no `.opencode`), `globalTarget()` (lines 149-154) kilo-first under `Global.Path.config`, `projectTarget()` fallback `.kilo/kilo.jsonc` (line 146). |
| `packages/opencode/src/kilocode/tui/config.ts` | `Effect.runPromise` → `AppRuntime.runPromise` for the TUI-config read (line 30) | Runtime plumbing only. Global target = `Global.Path.config` + `tui.jsonc/tui.json` (lines 65-71) — the **Kilo** global config dir. Project dirs `[".kilo",".kilocode"]` (line 27); default new file `.kilo/tui.json` (line 84). No opencode paths. |
| `script/upstream/utils/config.ts` | Adds `packages/opencode/src/cli/cmd/web.ts` to merge-tooling `skipFiles` | Tooling only. Importers verified via `rg "utils/config"`: exclusively `script/upstream/**` (merge.ts, analyze.ts, find-reset-candidates.ts, index.ts, codemods/transforms). Never imported by `packages/` — cannot feed runtime config. |
| `packages/kilo-vscode/src/kilo-provider/options.ts` | Adds `hideTopBar?: boolean` and `topBarSurface?: "tab"` option fields | Pure UI typing; no config-path assumptions. Not in the PR diff (main-branch change). |
| `packages/kilo-vscode/src/kilo-provider-utils.ts` | Session-refresh plumbing (`isCurrent` callback, `worktreeDirectories` fallback) | Zero `opencode`/`.kilo` path tokens in the file. Not in the PR diff. (Task-named `kilo-provider/utils.ts` does not exist; this is the file that exists and changed.) |
| JetBrains `KiloBackendCliManager.kt`, `KiloCliDownloader.kt`, `KiloRepoCli.kt` | Logging-only changes (CLI mode/extract/download log lines) | These resolve the CLI **binary** (bundled vs GitHub release), not config. No opencode paths. JetBrains config-path resolution lives in `KiloCliConfigPath.kt` (untouched by PR/delta): hard-coded `APP = "kilo"`, honoring `KILO_CONFIG_DIR` → `XDG_CONFIG_HOME/kilo` → `~/.config/kilo` (lines 6-12). |

### `privacy_mode` chain (task item: "reads privacy_mode only from global config — verify KILO path")

Fully traced at HEAD:

- **Read (TUI):** `sync.data.globalConfig.privacy_mode` (`kilocode/kilo-commands.tsx:142,194,200`, `kilocode/plugins/sidebar-footer.tsx:103`) ← sync store populated by `sdk.client.global.config.get()` (`packages/tui/src/context/sync.tsx:792`, `kilocode_change`-marked) → server route `/global/config` (`server/routes/instance/httpapi/groups/global.ts:71`) → `Config.getGlobal()` (`config/config.ts:429`) → `loadGlobal()` reading from `Global.Path.config` = `~/.config/kilo` with the kilo-first candidate list.
- **Write (TUI):** `/privacy` command → `sdk.client.config.overlayUpdate({ scope: "global", set: { privacy_mode } })` (`kilo-commands.tsx:201-204`) → `KilocodeConfigOverlay` `globalTarget()` → first existing of `kilo.jsonc, kilo.json, …` under `Global.Path.config`, defaulting to `kilo.jsonc` (`overlay.ts:149-154`).
- No read or write in this chain touches an `opencode` path as a *source of truth*; the retained `opencode.json(c)` entries in the candidate lists are the pre-existing, kilo-demoted file-compat shims documented since round 1.

## New findings

**None.** Round 3 finds 0 config regressions at `b6505b164b`, same as rounds 1 and 2.

## Notable non-findings (verified this round)

| Location | What it is | Verdict |
|---|---|---|
| New command-file endpoints (`packages/opencode/src/kilocode/command-files.ts`, handlers in `kilocode/server/httpapi/handlers/kilocode.ts:52-76`) | `/command` list/remove endpoints for the settings UI | Discovery is kilo-only: `config.directories()` (= `ConfigPaths.directories`: `Global.Path.config` + `.kilocode`/`.kilo` walk-ups + optional `KILO_CONFIG_DIR`) plus `WorkflowsMigrator.discoverWorkflows()` scanning `vscodeGlobalStorage/workflows`, `~/.kilocode/workflows`, `~/.kilo/workflows`, and project `.kilo/workflows` / `.kilocode/workflows` (`workflows-migrator.ts:14-18,99-113`). No opencode dirs consulted. Removal is additionally confined (rejects cache-backed locations, `command-files.ts:118-122`). |
| Agent Manager multi-project features (84 delta files under `packages/kilo-vscode/{src,webview-ui}/agent-manager/`) | Multi-project sidebar, base-branch prefetch, terminal navigation, project activation | Zero `opencode.json` / `.opencode` / `config/opencode` / `OPENCODE_CONFIG` tokens in either agent-manager tree. Project state dirs are `.kilo/agent-manager.json` (+ legacy `.kilocode/agent-manager.json`) only (`constants.ts:20-23`, `WorktreeManager.ts:634-641`). |
| `packages/kilo-jetbrains/.../KiloWorkspaceRpcApiImpl.kt:79-82` | `LEGACY = ["opencode.jsonc","opencode.json"]`, `LOCAL_DIRS = [".kilo",".kilocode",".opencode"]` | Pre-existing open-for-edit listing (the JetBrains mirror of VS Code's `config-file.ts` viewer): `localConfig()`/`globalConfig()` (lines 341-357) resolve an existing file to **open in the editor**; fallback for new files is `.kilo/kilo.jsonc` (project) and `kilo.jsonc` under the Kilo global dir (global). Untouched by PR and delta. |
| JetBrains test fixtures (`KiloCliDataParserTest.kt:592,604`, `ChatLogSummaryTest.kt:237`) | Error-message strings containing `/workspace/.opencode/tool/github-triage.ts` | Inert test data. The delta touches `KiloCliDataParserTest.kt` but its hunks (@@ 691, 705, 1817, 1826, 1878) do not touch the fixture lines (verified: no `opencode` content lines in the delta diff). |
| `packages/core/src/models-dev.ts:169-172` | `https://models.opencode.ai` default catalog URL | Pre-existing, `KILO_MODELS_URL`-overridable. PR diff for this file is schema-only (adds `InterleavedField`; drops the now-redundant `kilocode_change` markers around `reasoning_options` because upstream v1.18.13 shipped the same schema); the opencode URL lines are untouched. |
| `packages/opencode/src/provider/provider.ts:408` | Comment "options.region from opencode.json provider config" | Comment text; the PR diff's hunks (custom loaders, schema) do not touch this line. |
| `.opencode/command/translate.md` (repo root) | Upstream translation command; PR changes only the `model:` frontmatter line | Inert repo tooling — Kilo command discovery scans `.kilo`/`.kilocode` only (`paths.ts`), so it is never loaded as a command. |
| Pre-existing compat shims (all verified untouched by the PR this round) | `kilocode/config/sources.ts:60,125,258-259` (provenance lists + managed plist), `kilocode/config/global-stamp.ts:6`, `kilocode/config/config.ts:41,435` (file-name constants), `core/src/config.ts:143` (`kilocode_change`-marked names list), `config/tui-migrate.ts:26` + `config/tui.ts:118` (one-time tui-key migration off old `opencode.json`), `cli/cmd/mcp.ts:401-414` (`kilo mcp add` candidates), `kilocode/permission/config-paths.ts:23` (edit-permission classification), `kilocode/agent/index.ts:207` + `agent/agent.ts:220` + `core/src/plugin/agent.ts:146` (`.opencode/plans/*.md` allow rule), `installation/index.ts:189` + `cli/cmd/uninstall.ts:212-304` (old `.opencode/bin` cleanup), `skill/discovery.ts` (both packages; `.opencode-version` staging stamp), `core/src/plugin/skill.ts:23` (upstream config-authoring skill prompt), `kilo-vscode/src/kilo-provider/config-file.ts:34-96` (LEGACY viewer listing), `kilo-vscode/src/services/marketplace/relevance.ts:4` (search exclude glob), `managed.ts:8` (`ai.opencode.managed` plist domain), `kilocode/system-prompt.ts:29` (prompt *enforcing* `.kilo/`-only) | All pre-existing intentional compat/migration/display/branding; each containing file verified untouched by the full PR diff (`git diff 6fce4e2564...b6505b164b -- <path>` empty). None is a runtime fallback introduced by this PR. |
| `packages/tui/src/config/keybind.ts` | Adds `debug_view` keybind; `CommandMap` values `"opencode.status"` / `"opencode.debug"` | Upstream command-ID namespace strings, not config paths; pre-existing pattern extended by one entry. |
| Env-var surface | No `OPENCODE_CONFIG*` reads anywhere in `packages/opencode/src`, `packages/core/src`, `packages/kilo-vscode/src`, `packages/kilo-jetbrains`; `flag.ts` exposes only `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, `KILO_CONFIG_DIR` | Merge did not resurrect upstream env-var fallbacks. |

## Limitations

- Static inspection only (diff review + grep + call-site/helper reading), per the round's research-only scope; I did not boot the CLI or run `bun test`. Fastest empirical confirmation remains `bun test ./test/config/config.test.ts ./test/kilocode/` from `packages/opencode/`.
- The delta is an `origin/main` merge (216 commits, 433 files); I reviewed every config-path-relevant file in it individually but did not re-review main-branch changes unrelated to config paths (session/terminal/provider UI etc.) beyond token sweeps.
- The pre-existing tension noted in rounds 1-2 stands unchanged: `opencode.json(c)` *file* fallbacks are retained in `config.ts` while the migration notice says Kilo "no longer falls back" (about `.opencode` *directories*). Predates the PR; product matrix (files vs dirs) may warrant human re-confirmation, but nothing in this merge, the fix commits, or the main sync altered it.
- Marker compliance of new/changed `kilocode_change` annotations (e.g. the `models-dev.ts` marker drop where upstream caught up, the `tips-view.tsx` block) was verified by eye on the diff, not by running `script/check-opencode-annotations.ts --worktree`.
