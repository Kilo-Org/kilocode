# OPENCODE_MENTIONS_V2.md — Round 2: OpenCode branding audit for upstream-merge PR (v1.18.13)

## Scope

Round 1 reviewed head `cce22e608f` (see OPENCODE_MENTIONS.md). The merge branch then received 4 fix commits (`cbbbd7217f`, `af6d1ded6d`, `a4d86f117f`, `37a5cbf5db`; delta = `git diff cce22e608f..37a5cbf5db`, 65 files). Round 2 reviewed head: `37a5cbf5db` (worktree HEAD is `ca36b6bb9f`, which only adds round-1 report files — no code changes).

Questions: (1) are the round-1 findings fixed at the new head, (2) do the fix commits introduce new user-facing "OpenCode" mentions, (3) did round 1 miss anything in the full PR diff (`b135b4e10a..37a5cbf5db`).

## Methodology

- Re-checked each round-1 finding's file at `37a5cbf5db` directly and via the delta diff.
- Delta sweep: `git diff cce22e608f..37a5cbf5db | grep -i '^+' | grep -i opencode` plus URL patterns (`opencode\.ai`, `anomalyco/opencode`, `models\.opencode`); every hit drilled into per file.
- Fresh full-PR sweep: re-ran the round-1 greps at the new head (221 added opencode lines vs 245 at round-1 head — the reduction comes from the meta.txt rebrand, the http-recorder fix, and the `script/translate-app.*` deletion); per-file ranking of added lines; capital-`O` "OpenCode" sweep excluding imports; targeted sweeps for error messages, CLI help text, package.json `description`/`homepage`/`bugs`, config docs, generated SDK.
- Verified reachability: ran the new branding test, confirmed `packages/storybook` has no `src/` stories consuming the mocks, confirmed `packages/app`/`packages/desktop-electron` do not exist in this repo, confirmed `packages/kilo-vscode/src` still has zero `KILO_MODELS_URL` hits.

## Round-1 verification status

### Finding 1 — `packages/opencode/src/session/prompt/meta.txt` — FIXED (full)

All three spots rebranded in the delta (`af6d1ded6d`/`a4d86f117f` range; verified at head):

- Line 1: `You are Kilo, a coding agent...` (was "You are OpenCode")
- Line 56: `# Tool Use – Kilo Specifics` (was "OpenCode Specifics")
- Line 65: `...answer the question from the Kilo docs at https://kilo.ai/docs.` (was "OpenCode docs at https://opencode.ai/docs")
- Line 64 (`github.com/Kilo-Org/kilocode` feedback URL) unchanged, still correct.

Wiring unchanged: `system.ts:76` still routes `muse-spark` models to `PROMPT_META`. Backed by a new regression test (see Tests section).

### Finding 2 — `packages/http-recorder/package.json` — FIXED (full)

`homepage`/`bugs` restored to Kilo's pre-merge values in the delta:

```
-  "homepage": "https://github.com/anomalyco/opencode/tree/dev/packages/http-recorder",
-  "bugs": "https://github.com/anomalyco/opencode/issues",
+  "homepage": "https://github.com/Kilo-Org/kilocode/tree/main/packages/http-recorder",
+  "bugs": "https://github.com/Kilo-Org/kilocode/issues",
```

`repository` stayed Kilo-Org throughout. Note: no test or transform guards this file's metadata — a future upstream merge could silently re-revert it (the merge transforms in `script/upstream/transforms/transform-package-json.ts` handle scripts/deps, not homepage/bugs). Observation only.

### Finding 3 — `packages/core/src/models-dev.ts:169,172` — STILL OPEN (unchanged)

`const source = Flag.KILO_MODELS_URL || "https://models.opencode.ai"` untouched by the fix commits; same for `packages/ui/vite.config.ts:50` and `packages/llm/script/recording-cost-report.ts:5`. The VS Code extension still does not set `KILO_MODELS_URL` (zero hits in `packages/kilo-vscode/src`), so all clients default to the opencode.ai catalog. Status and severity unchanged from round 1: Low, flagged for human decision whether this upstream infra coupling is acceptable or should be repointed — the fix commits leave it as-is by design.

### Finding 4 — `packages/storybook/.storybook/mocks/app/context/language.ts` — STILL OPEN (unchanged, still dead code)

Identical OpenCode-branded strings at the same lines (`dialog.model.unpaid.freeModels.title`: "Free models provided by OpenCode" l.25, `opencode.ai/zen` l.51, etc.). The delta does not touch `packages/storybook` at all. Dead-code reasoning re-confirmed and strengthened: `packages/storybook` has **no `src/` directory** — there are no stories in the package, so nothing can import the aliased `@/context/*` mocks. Sibling mock `packages/storybook/.storybook/mocks/app/hooks/use-providers.ts` (also merged, not fixed) adds `{ id: "opencode", name: "OpenCode Zen" }` / `{ id: "opencode-go", name: "OpenCode Go" }` display names — same dead-code status; provider ids must stay `opencode*` to match catalog data, but the display names would surface if app stories are ever added. Severity unchanged: Low, borderline non-finding.

## New findings (introduced by the fix commits)

### 5. `.changeset/opencode-v1-18-0.md:5` — "Adopt OpenCode v1.18.0 improvements..." in release notes — LOW (verify)

New file added by fix commit `cbbbd7217f` (did not exist at round-1 head):

```
Adopt OpenCode v1.18.0 improvements, including code mode, expanded model reasoning controls, MCP reliability updates, and TUI enhancements.
```

Where a user sees it: per AGENTS.md, "changeset descriptions appear directly in release notes and are read by end users" — this sentence will ship verbatim in the `@kilocode/cli` / `kilo-code` changelogs. It is the only user-facing OpenCode brand mention added by the fix commits. Severity: Low — factually describes the upstream source, but Kilo's own changeset guidance says descriptions are end-user-facing product text; flag for human verification whether release notes should say "upstream" instead of naming OpenCode.

## Fix-commit tests — branding coverage

- **`packages/opencode/test/kilocode/session/meta-prompt.test.ts`** (new, 13 lines): routes through the real wiring (`SystemPrompt.provider({ api: { id: "meta/muse-spark-preview" } })`) and asserts the prompt contains `You are Kilo`, `Muse Spark`, `https://kilo.ai/docs`, and does **not** contain `You are OpenCode`, `identify yourself as OpenCode`, or `https://opencode.ai/docs`. **Ran it: 1 pass, 6 expects.** Would catch a regression of finding 1's identity line and docs URL. Gaps: does not assert the line-56 `# Tool Use – Kilo Specifics` heading or the line-64 `github.com/Kilo-Org/kilocode` feedback URL — a partial re-merge of those two lines alone would pass.
- **`script/upstream/transforms/transform-i18n.test.ts`** (new): asserts the merge i18n transform rewrites `"product": "OpenCode"` → `"Kilo"` and `opencode.ai/docs` → `kilo.ai/docs` **and appends `// kilocode_change` markers** to rebranded lines (new behavior in `transform-i18n.ts:203-204`), while preserving `.opencode/opencode.json` legacy names. Guards future merges for locale files — this is how the 19 `packages/ui/src/i18n/*.ts` files got their markers in the delta.
- Other new delta tests (`grok-reasoning-variants`, `kimi-adaptive-effort`, `transform-package-json` additions, `session-ui` prompt-input store tests) are not branding-related.
- Unguarded: finding 2's fix (http-recorder metadata) and finding 3 (catalog URL) have no test coverage.

## Delta review — remaining touched areas (all clean)

- **`packages/ui/src/i18n/*.ts` (19 files)**: delta only appends `// kilocode_change` to the already-Kilo-branded `dialog.usageExceeded.freeTier.description` lines ("Subscribe to Kilo Go..."). Zero opencode hits across all locale files at head.
- **`packages/opencode/src/cli/cmd/run/footer.command.tsx`**: keybinding plumbing (ctrl+p as up) with `kilocode_change` markers; no user-facing strings.
- **`packages/sdk-next/package.json`**: script reordering/timeout only; `@opencode-ai/client` dependency line is an internal identifier.
- **`packages/session-ui/**` (prompt-input)**: added opencode hits are all `@opencode-ai/*` import paths.
- **`script/translate-app.ts` / `script/translate-app.test.ts`**: **deleted** in the delta (removes round-1's internal-tooling mentions). Side observation: `.opencode/command/translate.md` is still tracked and now points at a deleted script — dangling internal command, functional not branding.
- **`packages/kilo-vscode`**: only a locale pluralization fix (`localeToBcp47`) + test; no branding strings.
- **`script/upstream/transforms/transform-package-json.ts`**: merge tooling now deletes upstream's `translate:app` root script and preserves `test:script:ci`; internal.

## Fresh full-PR sweep — nothing round 1 missed

The capital-`O` "OpenCode" sweep over all added lines at the new head maps entirely to round-1 findings/non-findings (artifacts video, codemode docs/fixtures, storybook mocks, test fixtures, theme internals) plus the one new finding above. No added opencode branding in error messages, CLI help/output, package.json descriptions, or config docs. `packages/kilo-docs` and `packages/sdk/js` (incl. `src/gen`) remain untouched by the PR. `packages/app`/`packages/desktop-electron` don't exist in this repo, so no upstream desktop-app UI strings enter.

## Notable non-findings (re-confirmed at new head)

- **`packages/tui/src/feature-plugins/home/tips-view.tsx`** — the `opencode.ai` share link, `ghcr.io/anomalyco/opencode` docker tip, etc. remain inside the `/* kilocode_change hide the entire list ... */` comment block (l.168); `TIPS` still evaluates dead. The 3 added opencode lines in the full-PR diff are edits inside that comment.
- **Shiki/pierre theme internals** — `packages/session-ui` passes `theme: "OpenCode"` while `OpenCodeTheme` (`packages/ui/src/context/marked-theme.tsx:4`) has `name: "Kilo"` and `marked-theme-register.tsx:9` registers it as `"Kilo"`. Internal identifiers, not user-facing branding. One observation outside branding scope: shiki resolves themes by `name`, so `theme: "OpenCode"` lookups against a theme named `"Kilo"` look like a possible name-resolution mismatch from the `0fff61fa62` rename (pre-dates round-1 head) — flag for functional verification by whoever owns markdown rendering.
- **`packages/core/src/plugin/skill/customize-opencode.md`** — pre-existing, unchanged by fix commits.
- **`artifacts/glm52-rise-video/`** — upstream marketing sources, unchanged status (observation only).
- **`packages/codemode/`** — private package; README/codemode.md/test fixtures mention OpenCode descriptively; internal only.
- **Internal identifiers** — `@opencode-ai/*` imports, `registerOpencodeSpinner`, `"opencode.debug"` command ids, provider ids (`opencode`, `opencode-go`, `providerID.startsWith("opencode")`), test fixtures (`models-api.json` "OpenCode Zen"/"OpenCode Go" provider names are upstream catalog data), `marked-parser.test.ts`, `transform-i18n.test.ts` fixtures, `.opencode/opencode.json` legacy paths (intentionally preserved).
- **`packages/opencode/src/session/prompt/copilot-gpt-5.txt`** ("Your name is opencode") — pre-existing, unchanged.

## Limitations

- Reachability judged statically; did not run the CLI, render the TUI/Storybook, or execute a muse-spark session (the branding test was run; UI was not).
- `models.opencode.ai` behavior vs `models.dev` not network-verified; finding 3 remains a human decision.
- Finding 5's severity assumes the standard changeset → GitHub release-notes pipeline; if release notes are hand-edited before publishing, impact is nil.
- The shiki theme-name observation was not executed (no markdown render test run); included only as a pointer.
- Pre-existing opencode mentions outside the PR diff were not exhaustively re-audited.
