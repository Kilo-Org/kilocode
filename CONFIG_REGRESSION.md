# Config Regression Review — upstream opencode v1.18.13 merge

- **Reviewed HEAD:** `cce22e608f` (worktree HEAD, merge of upstream v1.18.13 = `a105350812`)
- **Pre-merge Kilo base:** `b135b4e10a`
- **PR diff:** `git diff b135b4e10a..HEAD` (390 files)
- **Question:** does this PR (re)introduce fallback logic for `opencode` config files/dirs, or break `.kilo`-only config lookup?

## Methodology

1. Mapped the config machinery: `packages/opencode/src/config/config.ts` (loading/layering), `packages/opencode/src/config/paths.ts` (`ConfigPaths` project discovery), `packages/core/src/global.ts` (XDG/`Global.Path`), `packages/core/src/flag/flag.ts` (`KILO_*` env flags), `packages/opencode/src/kilocode/config/*` (Kilo-owned sources/overlay/stamp/migration-notice), `packages/opencode/src/config/managed.ts` + `tui.ts`/`tui-migrate.ts`, and `packages/kilo-vscode/src/kilo-provider/config-file.ts`.
2. Compared pre-merge vs post-merge: `git diff b135b4e10a..HEAD` on every file above; grep of base vs HEAD for `opencode` / `.kilo` path tokens.
3. Enumerated upstream config commits in range: `git log b135b4e10a..a105350812 -- packages/opencode/src/config packages/core/src/config ...` → 4 relevant commits, each checked against what the merge took.
4. Whole-tree post-merge grep for runtime-reachable `opencode.json` / `.opencode` / `config/opencode` references in `packages/opencode/src`, `packages/core/src`, `packages/kilo-vscode/src`; each hit classified and cross-checked for whether the PR touched that file.
5. Checked `.kilo` ordering in every multi-path candidate list.
6. Checked Kilo-specific config tests (`packages/opencode/test/kilocode/`, `packages/opencode/test/config/config.test.ts`) for removal/weakening.

## Findings

**None.** The merge introduces no new or restored `opencode` config-path fallback, and does not remove, reorder, or demote any `.kilo` config lookup. Details:

- The only change to the config loader in the entire 390-file diff is one hunk in `packages/opencode/src/config/config.ts:435-441` (upstream `254a481e5d` "fix(config): handle unavailable config directories"): upstream added `yield* fs.ensureDir(dir)` in `ensureGitignore`, and the merge correctly wrapped it in a `kilocode_change` block that swallows `PermissionDenied`/`NotFound` to preserve Kilo's sandbox-confinement behavior. No path candidates, ordering, or fallback logic touched. The accompanying upstream tests were taken and adapted to Kilo flag names (`packages/opencode/test/config/config.test.ts` — "ignores an inaccessible KILO_CONFIG_DIR", "creates a missing KILO_CONFIG_DIR"; pure additions, zero removed lines).
- `packages/core/src/fs-util.ts` (same upstream commit): adds `PermissionDenied` tolerance to `readFileStringSafe` and a new `resolve` helper — filesystem hardening, no path-resolution changes.
- `packages/core/src/v1/config/config.ts` (+`subagent_depth` schema field), `packages/core/src/v1/config/provider.ts` (widened `interleaved` field), `packages/core/src/config/plugin/agent.ts` (home-relative permission path expansion, upstream `fd9ee435ec`; subagent depth, `285d315b4e`): schema/permission changes only, no config discovery or path changes.
- `.kilo` ordering intact at HEAD in every candidate list:
  - `config.ts:199` `globalConfigFile()`: `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"]` — kilo first; identical to base.
  - `config.ts:382-386` global layering order `config.json → kilo.json → kilo.jsonc → opencode.json → opencode.jsonc` — identical to base.
  - `packages/opencode/src/config/paths.ts:29,35` `ConfigPaths.directories` targets `[".kilocode", ".kilo"]` only — file untouched by PR.
  - `packages/core/src/global.ts:12` `const app = "kilo"` (XDG dirs resolve to `~/.config/kilo` etc.) — file untouched by PR.
  - `packages/opencode/src/config/managed.ts:24-30` managed dirs are `/Library/Application Support/kilo`, `%ProgramData%\kilo`, `/etc/kilo` — untouched by PR.
- Kilo-only config tests (`test/kilocode/config-gitignore`, `config-injector`, `config-resilience`, `config-validation`, `agent-global-config-dirs`, …) all present at HEAD and untouched by the PR. No test weakening.
- The one kilo-adjacent removal in the diff (`Flag.KILO_DISABLE_PROJECT_CONFIG || !insideProject` in `packages/core/src/instruction-context.ts`) is a pure refactor — the identical guard survives at HEAD (`instruction-context.ts:48-49`), just restructured into `Effect.forEach`. `KILO_EXPERIMENTAL_FILEWATCHER` likewise still exists (`packages/core/src/flag/flag.ts:74`); its diff line was a call-site refactor in `watcher.ts`.

## Notable non-findings (pre-existing `opencode` references verified NOT introduced by this PR)

Each of these was checked with `git diff b135b4e10a..HEAD -- <file>` (empty = file untouched; the reference existed at base `b135b4e10a`):

| Location | What it is | Verdict |
|---|---|---|
| `packages/opencode/src/config/config.ts:199,385-386,675` | Global/project candidate lists still include `opencode.json(c)`; project discovery loops `["kilo", "opencode"]` names | Pre-existing intentional compat, all `kilocode_change`-marked; unchanged by this PR. (Note: coexists with the kilocode notice at `kilocode/config/config.ts:559` stating `.opencode` *directories* are no longer read — the retained fallback covers `opencode.json` *files* only. Pre-existing product decision, not a merge regression.) |
| `packages/opencode/src/kilocode/config/config.ts:555-610` | `detectOpencodeConfig()` finds leftover `~/.config/opencode` and project `.opencode/` dirs solely to emit a "Move your opencode configuration" migration notification | Intentional warn-only shim ("Kilo no longer falls back to opencode configuration"); untouched by PR. |
| `packages/opencode/src/kilocode/config/sources.ts:60,125,258-259`, `global-stamp.ts:6`, `overlay.ts:84,149`, `packages/core/src/config.ts:143` | Kilo-owned source/stamp/overlay lists including `opencode.json(c)` for provenance/stamping; macOS managed plist `ai.opencode.managed` | Pre-existing kilocode-owned compat/display logic; untouched by PR. |
| `packages/kilo-vscode/src/kilo-provider/config-file.ts:34-41,96` | Config-file viewer lists `LEGACY = ["opencode.jsonc","opencode.json"]` and `HOME = [".kilo",".kilocode",".opencode"]`, flagged `legacy` in UI | Pre-existing display-only listing so users see legacy files to migrate; untouched by PR. |
| `packages/core/src/plugin/skill.ts:23` | Built-in skill description telling the agent when to edit "opencode's own configuration: opencode.json, .opencode/, ~/.config/opencode/" | Pre-existing upstream prompt text (upstream's own config-authoring skill); untouched by PR. Cosmetic/brand drift at most — human may want to confirm Kilo intends to keep shipping it, but it is not a runtime config fallback and not a merge regression. |
| `packages/opencode/src/cli/cmd/mcp.ts:401-414` | `kilo mcp add` reads/writes `opencode.json(c)` candidates incl. under `.kilo/` and `.kilocode/` | Pre-existing upstream command behavior; untouched by PR. |
| `packages/opencode/src/config/tui-migrate.ts:26`, `tui.ts:118` | One-time migration of tui keys out of old `opencode.json` | Pre-existing intentional migration shim; untouched by PR. |
| `packages/opencode/src/config/config.ts:592` | Remote config discovery via `GET {url}/.well-known/opencode` | Pre-existing upstream well-known protocol endpoint name; untouched by PR. |
| `packages/tui/src/feature-plugins/home/tips-view.tsx:215-216` | Upstream tip strings "Create opencode.json…", "~/.config/opencode/tui.json" | Merged upstream text, but the entire upstream `TIPS` array remains commented out behind `/* kilocode_change hide the entire list … */`; the rendered list is `KILO_TIPS` (`packages/opencode/src/kilocode/cli/cmd/tui/feature-plugins/home/tips.ts:107-143`), which correctly says `kilo.json`, `~/.config/kilo/tui.json`, `.kilo/…`. Verified not user-visible. |
| `.opencode-version`, `.opencode/command/translate.md`, `script/translate-app.ts` (`.opencode/glossary/`) | Upstream repo-root translation tooling | Repo tooling (not shipped runtime); files were modified (`M`), i.e. present at base. Inert: Kilo command discovery scans `.kilo`/`.kilocode` dirs only (`paths.ts`), so `.opencode/command/translate.md` is never loaded as a command. |
| `packages/opencode/src/skill/discovery.ts:112,132`, `packages/core/src/skill/discovery.ts:129,180` | `.opencode-version` stamp file inside skill-hub staging dirs | Upstream skill-hub internal filename, not a config fallback; untouched by PR. |
| `packages/opencode/src/cli/cmd/uninstall.ts`, `installation/index.ts:189`, `agent/agent.ts:220`, `core/src/plugin/agent.ts:146` | Uninstall cleanup of old `.opencode/bin`; `.opencode/plans/*.md` permission allow | Pre-existing cleanup/permission rules; untouched by PR. |
| Diff hits: `models.opencode.ai`, `stats.opencode.ai` tokens, `tools.opencode.v2.*` test mocks, `ProviderV2.ID.opencode`, `OPENCODE_API_KEY` in models.json, i18n `dialog.provider.opencode.*` | Provider/branding/test data | Not config-path logic. |
| Removed diff line `"api": "https://api.kilo.ai/api/gateway"` | models.json provider data regenerated/reordered — the `kilo` provider entry still exists in the file | Data churn, not a config regression. |

## Limitations

- Runtime reachability was judged by static inspection (diff review + grep + call-site reading); I did not boot the CLI or run the config test suite. The new `KILO_CONFIG_DIR` tests and `test/kilocode/config-*` suite would be the fastest way to confirm behavior empirically (`bun test` from `packages/opencode/`).
- The pre-existing retention of `opencode.json(c)` *file* fallbacks in `config.ts` (global load + project discovery) slightly contradicts the kilocode migration notice's "no longer falls back" wording (which is about `.opencode` *directories*). This predates the PR, but a human may want to re-confirm the intended product matrix (files vs. dirs) since the wording is easy to misread.
- Merge-annotation compliance (`kilocode_change` markers present on the new hunk — they are) was verified by eye on the diff, not by running `script/check-opencode-annotations.ts`.
