# OPENCODE_MENTIONS_V3.md — Round 3: OpenCode branding audit for upstream-merge PR (v1.18.13)

## Scope

Round 1 reviewed head `cce22e608f` (OPENCODE_MENTIONS.md), round 2 reviewed `37a5cbf5db` (OPENCODE_MENTIONS_V2.md). Since round 2 the branch merged in latest `origin/main`. Round 3 reviewed head: `b6505b164b` (worktree HEAD; the two report-only commits on top of it add no code). New PR base: `6fce4e2564` (merge-base with origin/main, verified). Delta = `git diff 37a5cbf5db..b6505b164b` (433 files). Full PR diff = `git diff 6fce4e2564...b6505b164b` (419 files). Upstream merged tag: v1.18.13 = `a105350812` (verified present).

Questions: (1) are the still-open round-2 findings fixed at the new head, (2) does the main-merge delta introduce new user-facing "OpenCode" mentions, (3) did both prior rounds miss anything in the full PR diff.

## Methodology

- Re-checked each round-2 finding's file at `b6505b164b` directly; ran the branding regression test (`bun test ./test/kilocode/session/meta-prompt.test.ts` from `packages/opencode/` — 1 pass, 6 expects).
- Delta sweep: `git diff 37a5cbf5db..b6505b164b | grep -i '^+' | grep -i opencode` → 99 added lines (61 are `+++ b/packages/opencode/...` path headers; 38 content lines, each mapped to its file and drilled into). URL sweep on the delta (`opencode\.ai`, `anomalyco/opencode`, `sst/opencode`): **0 hits**.
- Fresh full-PR sweep: same greps over `6fce4e2564...b6505b164b` → 311 opencode lines (up from 221 at round-2 head; growth is the delta's changesets/tooling/test imports), 24 URL-pattern lines, capital-`O` "OpenCode" sweep excluding imports. Every file bucket cross-checked against round-1/2 classifications; previously unclassified files (session-ui v2 components, footer.view/subagent, plugin/modal, tool/registry, provider/transform, package.json files, SDK) inspected line-by-line.
- Reachability checks: `grep -rn 'KILO_MODELS_URL' packages/kilo-vscode/src/` (exit 1 — extension still does not override the catalog URL), `packages/storybook` still has no `src/` (mocks still dead), account command registration checked in `packages/opencode/src/index.ts`, help-snapshot diff read in full, SDK/OpenAPI added lines read, kilo-docs page diffs read (cli.md, cli-reference.md, gateway, security-reviews).
- Provenance checks via `git cat-file -e` / `git show` at base `6fce4e2564` and old head `37a5cbf5db` to separate "introduced by this PR" from "already on main".

## Round-2 verification status

### Finding 1 — `packages/opencode/src/session/prompt/meta.txt` — still FIXED

Verified at new head: line 1 "You are Kilo...", line 56 "# Tool Use – Kilo Specifics", line 64 `github.com/Kilo-Org/kilocode`, line 65 `https://kilo.ai/docs`. The main-merge did not regress it. Regression test re-run and passing (see Methodology).

### Finding 2 — `packages/http-recorder/package.json` — still FIXED

`homepage`/`bugs` at lines 13-14 are the Kilo-Org/kilocode URLs at the new head. (Still no transform/test guarding this file — round-2 observation stands.)

### Finding 3 — `packages/core/src/models-dev.ts:169,172` — STILL OPEN (unchanged)

`Flag.KILO_MODELS_URL || "https://models.opencode.ai"` untouched by the delta; same for `packages/ui/vite.config.ts:50` and `packages/llm/script/recording-cost-report.ts:5`. Re-verified the VS Code extension does not set `KILO_MODELS_URL` (grep exit 1 over `packages/kilo-vscode/src/`), so all clients default to the opencode.ai-hosted catalog. Status/severity unchanged: Low, human decision on whether this upstream infra coupling is acceptable.

### Finding 4 — `packages/storybook/.storybook/mocks/app/context/language.ts` — STILL OPEN (unchanged, still dead code)

Identical OpenCode-branded strings (l.25 "Free models provided by OpenCode", l.51 `opencode.ai/zen`, l.42/56/64 "models in OpenCode", l.47 "OpenCode Zen gives you access..."). Sibling mock `hooks/use-providers.ts` still adds "OpenCode Zen"/"OpenCode Go" display names. `packages/storybook` still has **no `src/` directory** — no stories exist to consume the mocks; dead code. Severity unchanged: Low, borderline non-finding.

### Finding 5 — `.changeset/opencode-v1-18-0.md` — SUPERSEDED (file deleted; wording moved → see finding 6)

The delta deletes `.changeset/opencode-v1-18-0.md` ("Adopt OpenCode v1.18.0 improvements...") and replaces it with two files: `opencode-v1-17-13-to-v1-18-0.md` (finding 7) and `opencode-v1-18-1-to-v1-18-13.md` (finding 6). The specific round-2 string is gone, but the same "Adopt OpenCode ..." release-notes pattern continues in the new file, so the underlying issue is **not** resolved.

## New findings (introduced by the delta)

### 6. `.changeset/opencode-v1-18-1-to-v1-18-13.md:5` — "Adopt OpenCode v1.18.1 through v1.18.13 improvements..." in release notes — LOW (verify)

New file added by the delta (commit `d99467fa02` "resolve merge conflicts"):

```
Adopt OpenCode v1.18.1 through v1.18.13 improvements, including model compatibility, MCP reliability, and TUI enhancements.
```

Where a user sees it: per AGENTS.md, changeset descriptions "appear directly in release notes and are read by end users" — this ships verbatim in the `@kilocode/cli` / `kilo-code` changelogs. Identical concern to round-2 finding 5 (which it replaces). Severity: Low — flag for human verification whether release notes should say "upstream" instead of naming OpenCode.

### 7. `.changeset/opencode-v1-17-13-to-v1-18-0.md:5` — "Changes from opencode v1.17.13 to v1.18.0 upstream:" — LOW (verify)

New file in the delta (30 lines; verified absent at `37a5cbf5db`), replacing the deleted v1-18-0 changeset with an itemized list headed:

```
Changes from opencode v1.17.13 to v1.18.0 upstream:
```

Names "opencode" (lowercase) as the upstream source in end-user release notes. Mitigating context: the sibling `.changeset/opencode-v1-17-9-to-v1-17-13.md` — already present at base `6fce4e2564`, i.e. shipped precedent on main — uses the identical "Changes from opencode v1.17.9 to v1.17.13 upstream:" phrasing, so this matches an established (and apparently accepted) Kilo changelog style. Severity: Low, listed for human verification per the when-in-doubt rule; arguably acceptable given precedent. Note the delta also rewrote several bullet lines in the pre-existing v1-17-9 file (wording only, still "opencode ... upstream" style).

## Notable non-findings (delta and full-PR sweep)

- **kilo-web command removal** — `packages/opencode/src/cli/cmd/web.ts` deleted (61 lines), `src/index.ts` replaces import/registration with `kilocode_change` comments ("upstream web command intentionally omitted; Kilo does not ship an embedded web UI"), help snapshot (`test/cli/help/__snapshots__/...snap`) drops the `kilo web --help` block, and `kilo-docs/pages/code-with-ai/platforms/cli-reference.md` drops the `kilo web` section. Zero opencode strings added anywhere in this area. The removal is also encoded in merge tooling (`script/upstream/transforms/remove-kilo-web.ts`, `skip-files.test.ts`, `script/upstream/utils/config.ts` skipFiles entry) — internal.
- **`packages/kilo-docs/pages/**` (15 pages changed: gastown ×3, cli, cli-reference, kiloclaw ×2, gateway/models-and-providers, security-reviews, agents/auto-model, skills, agent-manager, mcp ×2, rate-limits-and-costs)** — read the substantive diffs: all Kilo-branded content (Kilo Efficient model docs, `/move` `/diff` commands, KiloClaw). Zero opencode mentions in added lines; remaining delta files under kilo-docs are screenshot PNG pointer updates.
- **9 `packages/ui/src/i18n` locales (az, fi, hi, id, pa, sv, uk, ur, vi)** — pre-existing at old head; the delta only appends `// kilocode_change` markers to the already-Kilo-branded `dialog.usageExceeded.freeTier.description` lines. All 28 locale files at head contain **zero** opencode hits (en.ts included).
- **`packages/kilo-vscode/webview-ui/src/i18n/*` (14 locales + en)** — delta adds `sidebar.topBar.*` and `model.group.mostUsed` strings, all Kilo-branded. Pre-existing en.ts mentions (`settings.config.source.homeOpencode` "Home .opencode config" l.492, `projectOpencode` "Legacy .opencode config" l.499, `opencode.json` command config docs l.970/972) are intentional legacy-config compat and are **not** in the PR diff.
- **`packages/kilo-jetbrains/frontend/.../KiloBundle*.properties`** — delta adds `revert.banner.openDiff.title`, `action.Kilo.CoreInfo.bundled`, and icons; no opencode strings. The `settings.providers.note.opencode=Curated models including...` key (l.613) is pre-existing at base, an internal key name with a Kilo-neutral value.
- **`packages/kilo-jetbrains/CHANGELOG.md`** — delta adds released-version history ("Include upstream OpenCode updates through v1.17.13", "Adopt upstream reasoning variant metadata from OpenCode v1.18.11" under 7.0.13/7.0.13-rc.1). These entries are already at base `6fce4e2564` (absent from the full-PR opencode hit list) — historical release record merged in from main, not introduced by this PR.
- **New Kilo-owned code in the delta** — `packages/opencode/src/kilocode/cli/cmd/run-terminal.ts` (54 lines), `kilocode/command-files.ts` (130 lines; error messages generic: "command not found in registry" etc.), `kilocode/pii.ts` (`REDACTED_BALANCE = "•••"`), `kilocode/kilo-commands.tsx` (privacy-mode command: "Privacy Mode Enabled", "Blur PII (balance, email, etc.)...", `kilo.privacy`) — all Kilo-branded, no opencode mentions beyond `@opencode-ai/*` import paths (command-files.ts) and two code comments in kilo-commands.tsx (l.26/34, pre-existing context lines not added by the delta).
- **`packages/opencode/src/cli/cmd/account.ts:18`** `defaultConsoleUrl = "https://console.opencode.ai"` — pre-existing at base (not in the PR diff). Reachability checked: `index.ts:5,103` carry `kilocode_change` comments — "upstream account console intentionally omitted / not registered" — so the command is unreachable at runtime; only a unit test asserts the URL. Observation only, out of PR scope.
- **SDK/OpenAPI** — `packages/sdk` is touched by the PR now (openapi.json +74/−18-ish, `sdk.gen.ts`, `types.gen.ts`): added lines are query params (`file`, `full`), an `x-websocket` marker, and reasoning enums — zero opencode strings.
- **Package metadata** — root `package.json` (scripts only) and `packages/opencode/package.json` (`@opencode-ai/*` workspace dep lines only) add no user-facing branding; `name` stays `@kilocode/cli`. `packages/opencode/src/config/config.ts` adds no opencode strings.
- **Internal identifiers (all fine)** — `@opencode-ai/*` imports (incl. new `packages/core`/`packages/opencode` test files), `registerOpencodeSpinner` (footer.view.tsx, footer.subagent.tsx, tui/app.tsx, prompt/index.tsx), `"opencode.debug"` keybind command ids, `providerID.startsWith("opencode")`, `opencodeDir` local var in `kilo-vscode/script/local-bin.ts`, `.kilo/skills/jetbrains-cli-pin/*` and `plans/*` path references, `script/upstream/*` transform fixtures ("OpenCode uses opencode serve" test inputs), `packages/opencode/dist/` path in dev scripts.
- **Re-confirmed standing non-findings** — TUI `tips-view.tsx` opencode tips remain inside the `kilocode_change` block comment (dead); `artifacts/glm52-rise-video/` marketing sources unchanged in the delta; `packages/codemode/` private-package docs/fixtures ("opencode HttpApi" fixture, "owned by this OpenCode process" descriptions) internal-only; `test/tool/fixtures/models-api.json` "OpenCode Zen/Go" provider names are upstream catalog data; `packages/opencode/src/session/prompt/copilot-gpt-5.txt` ("Your name is opencode") pre-existing and unchanged; uninstall.ts `.opencode` marker detection is intentional compat (also pre-existing at base).
- **Shiki theme-name mismatch (functional pointer, not branding, persists)** — `packages/ui/src/context/marked-theme.tsx:4` sets `name: "Kilo"` and `marked-theme-register.tsx:9` registers it as `"Kilo"`, while `packages/session-ui` consumers still pass `theme: "OpenCode"` (`components/markdown.worker.ts:42,94,118`, `pierre/index.ts:190`, `pierre/worker.ts:25`). Same state as round 2's pointer (the worker file was renamed markdown-shiki.worker.ts → markdown.worker.ts by the merge). Still unexecuted — flag for whoever owns markdown/diff rendering.

## Limitations

- Reachability judged statically; the only test executed was the meta-prompt branding test. TUI, Storybook, extension, and JetBrains UI were not run.
- `models.opencode.ai` vs `models.dev` behavior not network-verified; finding 3 remains a human decision.
- Findings 6-7 severity assumes the standard changesets → release-notes pipeline; hand-edited release notes would nullify them.
- The shiki theme-name pointer was not executed (no render test run).
- Pre-existing opencode mentions outside the PR diff (e.g. account.ts) were not exhaustively audited — only egregious ones adjacent to reviewed areas are noted.
