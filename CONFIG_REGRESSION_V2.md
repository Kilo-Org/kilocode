# Config Regression Review V2 — upstream opencode v1.18.13 merge (round 2)

- **Reviewed HEAD:** `37a5cbf5db` (round-2 head; worktree HEAD is `ca36b6bb9f`, verified docs-only — adds the 7 round-1 report `.md` files, zero code delta, so all conclusions apply to both)
- **Round 1:** `CONFIG_REGRESSION.md` at `cce22e608f`, verdict: **0 findings**
- **Delta under scrutiny:** `git diff cce22e608f..37a5cbf5db` (65 files; fix commits `cbbbd7217f`, `af6d1ded6d`, `a4d86f117f`, `37a5cbf5db`)
- **Full PR diff:** `git diff b135b4e10a..37a5cbf5db` (pre-merge Kilo base `b135b4e10a`; upstream v1.18.13 = `a105350812`)
- **Question (unchanged):** does this PR (re)introduce fallback logic for `opencode` config files/dirs, or break `.kilo`-only config lookup?

## Methodology

1. Read round-1 report; re-verified every structural claim it makes against the new HEAD by direct file reads (line numbers below are at `37a5cbf5db`).
2. Examined the full 65-file delta commit-by-commit; classified every touched file for config-path relevance, with special attention to the five named areas (`packages/core/src/fs-util.ts`, `script/upstream/utils/config.ts`, `packages/kilo-vscode/webview-ui/src/context/language.tsx`, `packages/opencode/src/plugin/modal/*`, i18n files).
3. Traced the one ambiguous delta change (fs-util `ensureDir` EEXIST handling) to ground: read the `@kilocode/sandbox` `ensureDirectory` helper and upstream v1.18.13's own `fs-util.ts` to determine whether behavior changed.
4. Verified `script/upstream/utils/config.ts`'s import graph (`rg` importers) to confirm it cannot feed runtime config.
5. Fresh whole-tree sweep: `grep -rn "opencode.json\|\.opencode\|config/opencode"` over `packages/opencode/src`, `packages/kilo-vscode/src`, plus a broader `packages/core/src` sweep (`opencode.json|.opencode/|config/opencode|xdg.*opencode|"opencode"`); every hit classified and each containing file checked against the full PR diff (`git diff b135b4e10a..37a5cbf5db --name-only`) to distinguish PR-introduced vs pre-existing.
6. Grepped the full PR diff for *added* lines containing opencode path tokens (`opencode.json`, `.opencode`, `config/opencode`, `OPENCODE_CONFIG`, `xdgConfig`) and classified each.
7. Env-var check: `rg "OPENCODE_CONFIG"` across all three runtime packages; confirmed `packages/core/src/flag/flag.ts` reads only `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, `KILO_CONFIG_DIR`.
8. Re-checked `.kilo` ordering in every multi-path candidate list, `Global.Path` resolution, managed config dirs, migration-notice shim, and VS Code extension path assumptions.

## Round-1 verdict re-confirmation

**Confirmed — the clean verdict still holds at `37a5cbf5db`.** Every round-1 claim was re-verified in place:

- `packages/opencode/src/config/config.ts`: the full PR diff still contains exactly one hunk — `ensureGitignore` (`config.ts:435-441`) wrapping the upstream-added `fs.ensureDir(dir)` in a `kilocode_change` block swallowing `PermissionDenied`/`NotFound`. Verified via `git diff b135b4e10a..37a5cbf5db -- packages/opencode/src/config/config.ts` (no other hunks).
- `config.ts:199` `globalConfigFile()` candidates `["kilo.jsonc", "kilo.json", "opencode.jsonc", "opencode.json", "config.json"]` — kilo first, `kilocode_change`-marked, identical to base.
- `config.ts:380-386` global layering `config.json → kilo.json → kilo.jsonc → opencode.json → opencode.jsonc` — identical to base.
- `config.ts:675-676` project discovery loops `["kilo", "opencode"]` via `ConfigPaths.files` — `kilocode_change`-marked, kilo first, unchanged.
- `packages/opencode/src/config/paths.ts:29,35` — `ConfigPaths.directories` targets `[".kilocode", ".kilo"]` only; file untouched by PR.
- `packages/core/src/global.ts:12` — `const app = "kilo"`; XDG dirs resolve to `~/.config/kilo` etc.; file untouched by PR.
- `packages/opencode/src/config/managed.ts:24-30` — managed dirs `/Library/Application Support/kilo`, `%ProgramData%\kilo`, `/etc/kilo`; untouched by PR.
- Migration-notice shim `detectOpencodeConfig()` / `opencodeConfigNotification()` intact at `packages/opencode/src/kilocode/config/config.ts:555-610` (warn-only: "Kilo no longer falls back to opencode configuration"); file untouched by PR.
- VS Code extension: `packages/kilo-vscode/src/kilo-provider/config-file.ts` (LEGACY display list) and `packages/kilo-vscode/src/services/marketplace/relevance.ts` (search exclude glob) both untouched by the PR (`--name-only` empty).
- Upstream TUI tips still fully inside the `/* kilocode_change hide the entire list … */` block (`packages/tui/src/feature-plugins/home/tips-view.tsx:168-292`); the rendered list is `[...KILO_TIPS, ...TIPS(empty), …]` at line 137. The `opencode.json`/`~/.config/opencode/tui.json` tip strings remain unreachable. File untouched by the delta.
- Config tests: the delta touches no config test. Full PR's only config-test change remains the pure-addition `KILO_CONFIG_DIR` tests in `packages/opencode/test/config/config.test.ts` (round-1 verified); delta adds only unrelated tests (provider variants, meta-prompt, task-nesting, modal, transform, footer, language-utils).

## Delta commit scrutiny (the 65 files)

No delta file reads config paths, changes path resolution, or affects `.kilo` lookup order. Named files:

| File | What the delta does | Config-path verdict |
|---|---|---|
| `packages/core/src/fs-util.ts` | Removes the merge-era `Effect.catchIf(AlreadyExists …)` around `ensureDirectory(fs, path)` in `ensureDir` | **No behavior change.** `@kilocode/sandbox`'s `ensureDirectory` already swallows `AlreadyExists` internally (`packages/kilo-sandbox/src/filesystem.ts:15-22`); the removed wrapper was redundant (upstream's version wraps raw `fs.makeDirectory`, see `a105350812:packages/core/src/fs-util.ts:116-124`). `ensureDir` is now byte-identical to pre-merge base. No path candidates, ordering, or fallback touched. |
| `script/upstream/utils/config.ts` | Adds 3 skip-files (`script/translate-app.{ts,test.ts,md}`) and one `takeTheirsAndTransform` entry (`meta.txt`) to the merge-tooling config | **Tooling only.** Importers are exclusively `script/upstream/{merge,analyze,find-reset-candidates,index}.ts` (verified via `rg "upstream/utils/config"`); never imported by `packages/`. Cannot feed runtime config. |
| `packages/kilo-vscode/webview-ui/src/context/language.tsx` | `pluralCategory(locale() …)` → `pluralCategory(localeToBcp47(locale()) …)` | Pure i18n plural-category fix; no file/config access. |
| `packages/opencode/src/plugin/modal/modal.ts`, `models.ts` | Model-discovery failure tolerance (return catalog instead of `{}`), `interleaved` schema union widened | Provider model catalog logic; no config paths read or written. |
| `packages/ui/src/i18n/*.ts` (18 locale files) | Appends `// kilocode_change` marker to the pre-existing Kilo-branded `dialog.usageExceeded.freeTier.description` line (en.ts verified; all 18 files show the identical 1-line pattern) | Annotation-only fix improving marker compliance; string content unchanged. |

Remaining delta files, classified: `meta.txt` (prompt branding "You are Kilo" + `kilo.ai/docs` links — *reinforces* kilo-only docs), `provider/provider.ts` (`// kilocode_change end` marker fix + meta/github-copilot/azure loaders), `provider/transform.ts` (reasoning variants, cache-key condition relocation), `tool/task.ts` (subagent ancestor-row tolerance; reads session DB via `cfg.subagent_depth`, not config files), `cli/cmd/run/footer.command.tsx` (keybindings), `packages/llm/src/provider-error.ts` (retry classification), `packages/session-ui/.../prompt-input/*` (object-URL lifecycle), `packages/ui` components (scroll-view, toast), CI (`.github/workflows/test.yml`, `setup-bun`, new `script/check-test-ci.ts`), manifests/lockfile/patches (solid-js 1.9.12, dnd-kit patch drop), `script/translate-app.*` deletion (upstream tooling round 1 already judged inert), merge-transform tooling + tests, and the new test files listed above. **None reads or writes user config.**

## New findings

**None.** Round 2 finds 0 config regressions at `37a5cbf5db`, same as round 1.

## Notable non-findings (verified this round, not introduced by the PR or the delta)

| Location | What it is | Verdict |
|---|---|---|
| `packages/core/src/fs-util.ts` EEXIST removal (delta) | Looked like hardening removal on a config-adjacent path (`ensureGitignore → ensureDir`) | Traced to ground: sandbox `ensureDirectory` swallows `AlreadyExists` internally, so behavior is unchanged and identical to pre-merge base. One residual divergence from upstream: upstream re-checks `isDir` after EEXIST (fails if the entry is a non-directory), Kilo's sandbox helper swallows unconditionally — but that predates the PR. Not a config-path regression. |
| `script/upstream/transforms/transform-i18n.test.ts` (new in delta) | Test fixture contains `"legacy": ".opencode/opencode.json"` and asserts the transform re-brands `OpenCode→Kilo`/`opencode.ai→kilo.ai` while *preserving* legacy config names untouched | Merge-tooling unit test; asserts the sync pipeline does not rewrite legacy config *names* in i18n strings. Inert test data, and the asserted behavior is desirable. |
| Added full-PR-diff lines with opencode tokens | `models.opencode.ai` defaults (`KILO_MODELS_URL`-overridable), `ProviderV2.ID.opencode` test data, `tools.opencode.v2.*` test mocks, `dialog.provider.opencode*` i18n, stats.opencode.ai CSS comments, commented-out tips | All previously classified in round 1 or inert; no runtime config-path fallback among them. |
| `packages/opencode/src/server/shared/ui.ts:77`, `plugin/shared.ts:200`, `kilocode/provider/metadata.ts:11`, `cli/cmd/account.ts:18`, `core/src/observability/otlp.ts:38`, `core/src/plugin/provider/cerebras.ts:13`, `core/src/plugin/provider/opencode.ts`, `core/src/tool/webfetch.ts:150` | Comment, `engines.opencode` field, provider i18n key, console URL, telemetry service name, integration headers, provider ID | Not config paths; every containing file verified untouched by the full PR diff. |
| `packages/opencode/src/kilocode/system-prompt.ts:29` | Agent system prompt: "Put new commands and agents in `.kilo/`. Do not use `.kilocode/` or `.opencode/`" | Kilo-owned prompt *enforcing* kilo-only paths; untouched by PR. |
| `packages/opencode/src/kilocode/permission/config-paths.ts:23` | Permission-rule file set includes `opencode.json(c)` alongside `kilo.json(c)` | Kilo-owned edit-permission classification (protects legacy files from agent edits); untouched by PR. |
| `.opencode/command/translate.md`, `.opencode-version` (repo root) | Upstream repo translation tooling; PR changes only the `model:` frontmatter line | Inert repo tooling — Kilo command discovery scans `.kilo`/`.kilocode` only (`paths.ts`); never loaded as a command. Delta consistently deleted the companion `script/translate-app.ts`. |
| Pre-existing `opencode.json(c)` *file* fallbacks (`config.ts:199,385-386`), `kilocode/config/{sources,overlay,global-stamp}.ts`, `core/src/config.ts:143`, `cli/cmd/mcp.ts:401-414`, `config/tui-migrate.ts` | Intentional compat/migration/provenance shims | All `kilocode_change`-marked or Kilo-owned, all untouched by the PR; unchanged from round 1's non-finding table. |
| Env-var surface | No `OPENCODE_CONFIG*` reads exist anywhere in `packages/opencode/src`, `packages/core/src`, `packages/kilo-vscode/src`; `flag.ts` exposes only `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, `KILO_CONFIG_DIR` | Merge did not resurrect upstream env-var fallbacks. |

## Limitations

- Static inspection only (diff review + grep + call-site/helper reading); I did not boot the CLI or run `bun test`. Fastest empirical confirmation remains `bun test ./test/config/config.test.ts ./test/kilocode/` from `packages/opencode/`.
- The fs-util EEXIST analysis rests on reading `@kilocode/sandbox`'s `ensureDirectory` source; I did not exercise the Windows/Bun failure mode empirically. Impact in the worst case would be a Windows-only mkdir-race defect, not a config-path fallback — and the code is byte-identical to pre-merge base.
- The pre-existing tension noted in round 1 stands unchanged: `opencode.json(c)` *file* fallbacks are retained in `config.ts` while the migration notice says Kilo "no longer falls back" (about `.opencode` *directories*). Predates the PR; product matrix (files vs dirs) may warrant human re-confirmation, but nothing in this merge or the fix commits altered it.
- Marker compliance of the delta's new `kilocode_change` annotations was verified by eye on the diff, not by running `script/check-opencode-annotations.ts --worktree`.
