# Config Regression Review V4 — upstream opencode v1.18.13 merge (round 4)

- **Reviewed HEAD:** `b793883de6` (= worktree `HEAD~3`; the 3 commits above it are report-only `.md` additions — verified `git diff b793883de6 HEAD -- packages/ script/ .github/` is empty, so all line numbers below are at `b793883de6`)
- **Round 1:** `CONFIG_REGRESSION.md` at `cce22e608f`, verdict: **0 findings**
- **Round 2:** `CONFIG_REGRESSION_V2.md` at `37a5cbf5db`, verdict: **0 findings**
- **Round 3:** `CONFIG_REGRESSION_V3.md` at `b6505b164b`, verdict: **0 findings**
- **Delta under scrutiny:** `git diff b6505b164b..b793883de6` (151 files; 60 commits, dominated by merges of `origin/main` and the advanced base branch `kilo-opencode-v1.18.0`)
- **Full PR diff:** `git diff 4f59fcb666...b793883de6` (422 files; new PR base `4f59fcb666`, which descends from round-3 base `6fce4e2564`; upstream v1.18.13 = `a105350812`)
- **Question (unchanged):** does this PR (re)introduce fallback logic for `opencode` config files/dirs, or break `.kilo`-only config lookup?

Scope note: the sandbox "live settings" work (main PR #12600, commit `4e36297668`) is an ancestor of the new base `4f59fcb666` (verified `git merge-base --is-ancestor`), so it appears in the round-4 **delta** but **not** in the full PR diff. It is fully reviewed here as delta change.

## Methodology

1. Read all three prior reports; re-verified every structural claim against `b793883de6` by direct file reads.
2. Enumerated the delta (`b6505b164b..b793883de6`, 151 files) and the full PR diff (`4f59fcb666...b793883de6`, 422 files); filtered both for config-path-relevant files.
3. Diffed `packages/opencode/src/config/config.ts` both ways (delta and full PR) and checked every hunk for path/discovery changes.
4. Traced the sandbox live-settings chain end to end: `config-console.ts` overlay write → `KilocodeConfigWriter`/`KilocodeConfigOverlay` target resolution → `ConfigUpdated` event → `policy.ts` revision bump → `reconcile()` re-read via `Config.Service.get()` → `SandboxStore`/`SandboxPreference` persistence roots.
5. Scrutinized the delta's other config-adjacent files: `kilocode/agent-manager/service.ts`, `kilo-vscode/src/utils.ts`, `KiloProvider.ts`, `kilo-provider/*`, `command/index.ts`, the new `kilocode/process/env.ts` and its consumers, and the delta's config tests.
6. Fresh whole-tree sweep: the prescribed `grep -rn "opencode.json\|\.opencode\|config/opencode\|OPENCODE_CONFIG"` over `packages/opencode/src`, `packages/core/src`, `packages/kilo-vscode/src` (`*.ts`; 62 hits) — every hit classified, every containing file checked against the full PR diff; for the 3 touched files, verified the token-bearing lines lie outside the PR diff hunks.
7. Greped the delta diff for *added* and *removed* lines containing config-path tokens (`opencode.json`, `.opencode`, `config/opencode`, `OPENCODE_CONFIG`, `xdgConfig`, `kilo.json`, `.kilo`, `KILO_CONFIG`) and classified each.
8. Env-var sweep: `OPENCODE_CONFIG*`, `OPENCODE_MODELS_URL`, `xdgConfig*opencode` — zero hits in all three runtime trees.

## Prior-verdict re-confirmation

**Confirmed — the clean verdict still holds at `b793883de6`.** Every round-1/2/3 structural claim re-verified in place:

- `packages/core/src/global.ts:12` — `const app = "kilo"` (`kilocode_change`); `Global.Path.config` = `xdgConfig/kilo`, `Global.Path.state` = `xdgState/kilo` (lines 24-25), overridable only via `KILO_CONFIG_DIR` (line 80). File untouched by PR diff and delta.
- `packages/opencode/src/config/paths.ts:29,35` — `ConfigPaths.directories` targets `[".kilocode", ".kilo"]` only (`kilocode_change`), plus `Global.Path.config` and optional `KILO_CONFIG_DIR`. File untouched by PR diff and delta.
- `packages/opencode/src/config/managed.ts:23-27` — managed dirs `/Library/Application Support/kilo`, `%ProgramData%\kilo`, `/etc/kilo` (`kilocode_change`-marked). File untouched by PR diff and delta.
- Migration-notice shim intact: `detectOpencodeConfig()` / `opencodeConfigNotification()` at `packages/opencode/src/kilocode/config/config.ts:562-605` (warn-only: "Kilo no longer falls back to opencode configuration"; detects leftover `~/.config/opencode` + project `.opencode/` dirs). File untouched by PR diff and delta.
- `packages/opencode/src/config/config.ts` (the one delta-touched structural file):
  - Full PR diff still contains exactly **one hunk** — `ensureGitignore` (`config.ts:435-440`) wrapping upstream's `fs.ensureDir(dir)` in a `kilocode_change` block swallowing `PermissionDenied`/`NotFound`. Verified via `git diff 4f59fcb666...b793883de6 -- packages/opencode/src/config/config.ts`.
  - The delta's 3 hunks add a `sandbox` boolean to `ConfigUpdated` event payloads only (`config.ts:1023,1078,1090,1107`); **no path, candidate-list, ordering, or discovery change**. These hunks entered via the `origin/main` merge (`4e36297668`) and are already in the new base, hence absent from the PR diff.
  - `globalConfigFile()` (`config.ts:199`): candidates `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"]` — kilo first, identical to base.
  - Global layering (`config.ts:380-386`): `config.json → kilo.json → kilo.jsonc → opencode.json → opencode.jsonc` — identical to base, `kilocode_change`-marked.
  - Project discovery (`config.ts:675`) loops `["kilo", "opencode"]` via `ConfigPaths.files` — kilo first, pre-existing compat, untouched line.
  - Remote config well-known endpoint `${url}/.well-known/opencode` (`config.ts:592`) — pre-existing upstream protocol name, untouched line.
- Command discovery chain unchanged and kilo-only: `config.ts:698,714` loops `ConfigPaths.directories()` (kilo-only dirs) and `config.ts:785` calls `ConfigCommand.load(dir, …)`, which scans `{command,commands}/**/*.md` **per config directory** (`config/command.ts:32`). `command/index.ts` itself contains no filesystem discovery (commands come from defaults, `cfg.command`, MCP prompts, skills); its delta only removes the two legacy `local-review*` registrations. No new runtime discovery of `.opencode/command` landed; the in-repo `.opencode/command/translate.md` orphan remains unreachable. `config/command.ts` and `kilocode/command-files.ts` are untouched by both delta and PR diff.

## Delta commit scrutiny (config-relevant files only)

| File | What the delta does | Config-path verdict |
|---|---|---|
| `packages/opencode/src/config/config.ts` | Adds `sandbox: Object.hasOwn(config, "sandbox")` / `sandboxChanged` to three `ConfigUpdated` event payloads | Event-payload plumbing only. Write/read paths unchanged: `Config.update` delegates to `KilocodeConfig.updateProjectConfig` (kilo-owned, untouched); `Config.updateGlobal` writes `globalConfigFile()` under `Global.Path.config`. |
| `packages/opencode/src/kilocode/config/writer.ts` | `Result` gains `changed` + `sandboxChanged`; same fields on early return | No path change. Write target is still `KilocodeConfigOverlay.target(input)` (`writer.ts:35,56,84`). |
| `packages/opencode/src/kilocode/config/overlay.ts` | — (untouched by delta and PR diff; re-verified) | Target resolution remains kilo-first/kilo-only: `files` (line 84) `["kilo.jsonc","kilo.json","opencode.jsonc","opencode.json"]` (pre-existing file compat), `dirs` (line 85) `[".kilocode",".kilo"]`, project default `.kilo/kilo.jsonc` (line 146), global candidates under `Global.Path.config` (lines 150-151), config roots `[Global.Path.config, ~/.kilocode, ~/.kilo]` (line 242). |
| `packages/opencode/src/kilocode/sandbox/policy.ts` | Live-refresh rework: `GlobalBus` listener bumps a `revision` on `global.config.updated` with `sandbox===true`; `current()` reconciles stale session snapshots; `filterWritable()` drops inaccessible/worktree-ancestor writable paths | Reads: `SandboxConfig.resolve(yield* Config.Service.get())` (`policy.ts:359,396`) — the merged config from kilo paths only. Writes: `SandboxStore.write` / `SandboxPreference.write`. No opencode path is read, written, or reordered; the env deny list stays `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, `KILO_CONFIG_DIR`, `KILO_SERVER_*` (`policy.ts:263`). `filterWritable` narrows sandbox profiles; it does not touch config discovery. |
| `packages/opencode/src/kilocode/sandbox/store.ts` | Comment reword + one line rewrap | Persistence root unchanged: `store.ts:19` `path.join(realpathSync.native(path.dirname(Global.Path.state)), "kilo-sandbox-policy")` — a sibling of the **kilo** state dir. Kilo-only. |
| `packages/opencode/src/kilocode/sandbox/state.ts` | Indentation-only reformat of a DB select | Session-metadata DB access; no filesystem config path. |
| `packages/opencode/src/kilocode/sandbox/preference.ts`, `config.ts` | — (untouched by delta; re-verified) | `preference.ts:8` root = sibling of kilo state dir (`kilo-sandbox-preference`); `config.ts:39-48` `resolve()` reads only the in-memory `config.sandbox` object. |
| `packages/opencode/src/kilocode/server/httpapi/handlers/config-console.ts` | After overlay writes, emits `ConfigUpdated` with `sandbox: result.sandboxChanged` (global) / `sandbox: true` (project, when changed); global dispose now gated on `result.changed` | Write path = `KilocodeConfigWriter.write` → overlay target (kilo-only, above). Event payload only; no path logic. |
| `packages/opencode/src/kilocode/agent-manager/service.ts` | `layer()` timeout `"10 seconds"` → `"60 seconds"` | The file contains no config-path logic at all (only Log/LayerNode imports matched token scans). |
| `packages/kilo-vscode/src/utils.ts` | Adds `isCursorHost()` (`vscode.env.appName`) | UI host detection; no config-path assumptions. |
| `packages/kilo-vscode/src/KiloProvider.ts` | Wires `watchAutoApprovalReasonConfig`; `topBar` now also requires `isCursorHost()` | VS Code settings plumbing + UI; no file config paths. |
| `packages/kilo-vscode/src/kilo-provider/auto-approval-reason-settings.ts` (new) | Reads `vscode.workspace.getConfiguration("kilo-code.new").showAutoApprovalReason` | VS Code Settings API, not file config. Kilo-namespaced key. |
| `packages/kilo-vscode/src/kilo-provider/commands.ts`, `early-message.ts` | Command payload gains `agent`/`model`/`variant`; new settings message route | No path logic. |
| `packages/opencode/src/kilocode/process/env.ts` (new) + consumers (`tool/shell.ts`, `lsp/launch.ts`, `mcp/index.ts`, `format/index.ts`, `background-process/index.ts`, `interactive-terminal/index.ts`, `util/process.ts`) | Central `modelEnv()` strips `KILO_SERVER_*` + `KILO_CONFIG*` from child-process env; `Process.spawn` gains `extendEnv` | Anti-credential-leak hardening. Only `KILO_*` variables; no opencode paths or config discovery. |
| `packages/opencode/src/kilocode/kilo-commands.tsx`, `plugins/sidebar-footer.tsx` | `privacy_mode` display now also honors merged project config (`sync.data.config.privacy_mode`) alongside global | Read-side widening only; merged config comes from kilo paths; the write still goes to the **global** overlay (`scope: "global"`). |
| `packages/opencode/src/session/session.ts` | Fork carries `platform` telemetry attribution | No config path. |
| Tests: `test/kilocode/config/config.test.ts`, `test/kilocode/server/config-overlay.test.ts`, `test/kilocode/tool/shell-env.test.ts`, `test/lsp/launch.test.ts`, `test/kilocode/sandbox/*` | Cover the sandbox-event payload, live-settings application (writing `kilo.json` into a tmpdir global config, `config-overlay.test.ts` new tests at lines 742+), env scrubbing | Pure additions/rewraps; all path tokens are kilo-named. |
| `.github/workflows/check-opencode-annotations.yml`, `script/check-architecture.ts`, `script/architecture-allowlist.json` | CI gains an architecture-boundary check for Kilo-owned code | Tooling; no runtime config. |

### Sandbox "live settings" chain (task item 4)

Fully traced at HEAD:

1. **Write:** HTTP `PATCH /config/overlay` → `config-console.ts:87` `KilocodeConfigWriter.write` → `KilocodeConfigOverlay.target()` → kilo-first candidates; project default `.kilo/kilo.jsonc`, global under `Global.Path.config`. No opencode target exists (overlay `dirs` list contains no `.opencode`).
2. **Signal:** on success the handler emits `ConfigUpdated` with `properties.sandbox` set only when the patch contained a `sandbox` key (`config-console.ts:111-121,124-134`; `writer.ts:89`). `Config.update`/`Config.updateGlobal` do the same for their paths (`config.ts:1023,1090,1107`).
3. **Trigger:** `policy.ts:33-35` — `GlobalBus.on("event")` bumps a module-level `revision` only for `global.config.updated` with `sandbox === true`.
4. **Re-read:** on the next sandboxed tool call, `execute → current(sessionID, true)` (`policy.ts:602`) detects a stale `synced` marker and `reconcile()` re-reads `Config.Service.get()` — the merged kilo-path config, already scope-filtered by `SandboxConfig.scope(next, scope)` at merge time (`config.ts:558`, pre-existing `kilocode_change`: local/project sources may only *tighten* — keep `enabled: true` / `network: "deny"` — only global sources can widen).
5. **Persist:** updated snapshots go to `SandboxStore.write` (`~/.local/state/kilo`-sibling `kilo-sandbox-policy/…`, `store.ts:19`) and the per-directory toggle preference to `SandboxPreference.write` (`kilo-sandbox-preference/…`, `preference.ts:8`).

**Answer:** the chain reads from and writes to kilo paths only, and reorders nothing. No kilo candidate list was touched anywhere in the delta.

## New findings

**None — 0 config regressions at `b793883de6`**, same as rounds 1-3.

**Flagged observation (outside config-path scope, added per "when in doubt, flag for human verification"):** `packages/core/src/models-dev.ts:169` — the merge carries the upstream-v1.18.13-era default catalog URL `Flag.KILO_MODELS_URL || "https://models.opencode.ai"`, while the base branch (both old base `6fce4e2564:166` and new base `4f59fcb666:166`) deliberately defaults to `"https://models.dev"` (upstream v1.18.13 `a105350812:160` itself still uses `Flag.OPENCODE_MODELS_URL || "https://models.opencode.ai"`). The flip `models.dev → models.opencode.ai` **is** present as an added/removed pair in the PR diff (hunk `@@ -163,10 +166,10 @@`; it was equally present in the round-3 diff — round 3's "opencode URL lines are untouched" phrasing was inaccurate about the diff mechanics, though its not-a-config-regression classification stands). This is a model-catalog endpoint, not config discovery, and is `KILO_MODELS_URL`-overridable — but if the PR merges as-is it will revert the base branch's `models.dev` default. A human should confirm which URL is intended for the merged result.

## Notable non-findings (verified this round)

| Location | What it is | Verdict |
|---|---|---|
| Fresh sweep (62 hits, 31 files) vs round 3's 67 hits | Same prescribed pattern over the same three TS trees | Delta vs round 3 is explained by round 3 additionally sweeping `packages/kilo-jetbrains` (`*.kt`); the TS-tree hits are a subset match of round 3's classified list. No new hit locations appeared. |
| Sweep files touched by the full PR diff | Exactly 3 of 31: `config/config.ts`, `provider/provider.ts`, `core/src/models-dev.ts` | `config.ts`: hunks verified above — token lines (199, 385-386, 592, 675) untouched. `provider.ts`: PR hunks (`@@ -48`, `-224`, `-235`, `-296`, `-304`, `-918` …) do not cover the line-408 comment "options.region from opencode.json provider config". `models-dev.ts`: see flagged observation above. |
| Pre-existing compat shims (all verified untouched by the full PR diff this round — `git diff 4f59fcb666...b793883de6 -- <path>` empty) | `kilocode/config/sources.ts:60,125,258-259` (provenance lists + managed plist), `kilocode/config/global-stamp.ts:6`, `kilocode/config/config.ts:41,435` (file-name constants), `kilocode/config/overlay.ts:84,150` (kilo-first candidate lists with legacy file compat), `core/src/config.ts:143` (`kilocode_change` names list), `config/tui-migrate.ts:26` + `config/tui.ts:118` (one-time tui-key migration), `cli/cmd/mcp.ts:401-414` (`kilo mcp add` candidates), `kilocode/permission/config-paths.ts:23` (edit-permission classification), `kilocode/agent/index.ts:207` + `agent/agent.ts:220` + `core/src/plugin/agent.ts:146` (`.opencode/plans/*.md` allow rule), `installation/index.ts:189` + `cli/cmd/uninstall.ts:212-304` (old `.opencode/bin` cleanup), `skill/discovery.ts` (both packages; `.opencode-version` staging stamp), `core/src/plugin/skill.ts:23` (upstream config-authoring skill prompt), `kilocode/system-prompt.ts:29` (prompt *enforcing* `.kilo/`-only), `kilo-vscode/src/kilo-provider/config-file.ts:34-96` (LEGACY viewer listing), `kilo-vscode/src/services/marketplace/relevance.ts:4` (search exclude glob), `config/managed.ts:8` (`ai.opencode.managed` plist domain), `cli/cmd/account.ts:18`, `server/shared/ui.ts:77`, `plugin/shared.ts:200`, `kilocode/provider/metadata.ts:11`, `core/src/plugin/provider/opencode.ts`, `core/src/catalog.ts:244` (branding/provider IDs/telemetry) | All pre-existing intentional compat/migration/display/branding; none is a runtime fallback introduced by this PR. |
| `packages/opencode/src/kilocode/server/httpapi/handlers/kilo-gateway.ts:328` | Calls `KilocodeConfig.opencodeConfigNotification(...)` | The warn-only migration shim's only call site; file untouched by PR diff and delta. |
| Agent Manager extension trees (11 delta files under `packages/kilo-vscode/src/agent-manager/`) | Multi-project routing, orchestration bridge, terminal management | Zero `opencode.json` / `.opencode` / `OPENCODE_CONFIG` tokens. State remains `.kilo/agent-manager.json` (+ legacy `.kilocode/agent-manager.json` migration); `constants.ts` / `WorktreeManager.ts` untouched by the delta. One delta test fixture creates a `.kilo/` dir (`agent-manager-orchestration-bridge.test.ts`) — kilo-only, inert. |
| Env-var surface | Zero `OPENCODE_CONFIG*` / `OPENCODE_MODELS_URL` / `xdgConfig*opencode` hits in the three runtime trees; the delta only *removes* `KILO_CONFIG*` from child-process env (`kilocode/process/env.ts` + 6 consumers + 2 new tests asserting the scrub) | Merge did not resurrect upstream env-var fallbacks; the delta hardens isolation of the kilo flags. |
| `.changeset/sandbox-live-settings.md` | "Apply saved sandbox settings to existing sessions…" | Documents the reviewed main-branch feature; consistent with the traced chain. |

## Limitations

- Static inspection only (diff review + grep + call-site/helper reading), per the round's research-only scope; I did not boot the CLI or run `bun test`. The delta's own tests (`config-overlay.test.ts` live-settings trio, `config.test.ts` sandbox-event test) are the fastest empirical confirmation: `bun test ./test/kilocode/` from `packages/opencode/`.
- The delta is again an `origin/main` + base-branch merge (60 commits, 151 files); I reviewed every config-path-relevant file in it individually but did not re-review unrelated main-branch changes (PTY, terminal UI, i18n, build tooling) beyond the token sweeps.
- The `models.dev` vs `models.opencode.ai` flag is based on git archaeology (base/head/upstream blob comparison), not on testing which endpoint actually serves Kilo today; product intent needs human confirmation.
- The pre-existing tension noted in rounds 1-3 stands unchanged: `opencode.json(c)` *file* fallbacks are retained in `config.ts` while the migration notice says Kilo "no longer falls back" (about `.opencode` *directories*). Predates the PR; nothing in this round's delta altered it.
- Marker compliance of new/changed `kilocode_change` annotations (e.g. `process/env.ts` consumers, `mcp/index.ts` env hunk) was verified by eye on the diff, not by running `script/check-opencode-annotations.ts --worktree`.
