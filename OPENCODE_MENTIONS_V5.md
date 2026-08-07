# OPENCODE_MENTIONS_V5.md — Round 5: OpenCode branding audit for upstream-merge PR (v1.18.13)

## Scope

Round 1 reviewed head `cce22e608f` (OPENCODE_MENTIONS.md), round 2 `37a5cbf5db` (V2), round 3 `b6505b164b` (V3), round 4 `b793883de6` (V4). Round 5 reviewed head: `4bb1c2a45b` (worktree HEAD~4; the four commits on top — `37bce69b34`, `0c56eb8220`, `79b02370fc`, `01fe00178c` — add report files only, verified via `git diff 4bb1c2a45b..HEAD --stat`: 28 markdown files, +2545/−0). PR base: `4f59fcb666` (merge-base with the head, re-verified: `git merge-base 4f59fcb666 4bb1c2a45b` → `4f59fcb666`). Delta since round 4 = single commit `4bb1c2a45b` "fix(core): address round 4 review findings for upstream merge" (5 files: `packages/core/src/models-dev.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/opencode/script/kilocode/test-cli.ts`, `packages/opencode/src/config/config.ts`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`). Full PR diff = `git diff 4f59fcb666...4bb1c2a45b` (422 files, same count as round 4). Upstream merged tag: v1.18.13 = `a105350812`.

Questions: (1) does the fix commit resolve the flagship `models.opencode.ai` default-catalog finding (and does the resulting file state match), (2) are the remaining open round-4 findings fixed, (3) does the fix commit introduce new user-facing "OpenCode" mentions, (4) did all four prior rounds miss anything in the full PR diff.

## Methodology

- Read the fix commit in full (`git show 4bb1c2a45b`) and the resulting `packages/core/src/models-dev.ts` at the head; compared against base (`4f59fcb666:166` = `Flag.KILO_MODELS_URL || "https://models.dev"`, the deliberate Kilo default per CONFIG_REGRESSION_V4) and upstream (`a105350812:160` = `Flag.OPENCODE_MODELS_URL || "https://models.opencode.ai"`).
- Head-tree sweep for remaining `models.opencode.ai`: `git grep -i 'models\.opencode\.ai' 4bb1c2a45b -- packages/` → 2 hits (`packages/ui/vite.config.ts:50`, `packages/llm/script/recording-cost-report.ts:5`); both files' base and upstream states checked (`git show 4f59fcb666:...` / `a105350812:...`) and both confirmed present as flip pairs in the full PR diff.
- Fix-commit delta sweep: `git show 4bb1c2a45b | grep -i '^+' | grep -i opencode` → only `+++ b/packages/opencode/...` path headers; **zero** added content lines with opencode tokens. Zero URL hits.
- Re-verified each carried finding's file at `4bb1c2a45b` directly: storybook mocks (`language.ts`, `use-providers.ts`), `.changeset/opencode-v1-17-13-to-v1-18-0.md`, session-ui shiki `theme: "OpenCode"` sites vs `"Kilo"` registration; re-confirmed `packages/storybook` has no `src/` and **zero** stories anywhere import `@/context/*` (`git grep '@/context/'` over `*.stories.*` → exit 1); re-confirmed the VS Code extension still does not set `KILO_MODELS_URL` (`git grep` over `packages/kilo-vscode/src/` → exit 1); re-confirmed the changeset precedent file `.changeset/opencode-v1-17-9-to-v1-17-13.md` is still present with identical phrasing.
- Re-ran the branding regression test from `packages/opencode/`: `bun test ./test/kilocode/session/meta-prompt.test.ts` → **1 pass, 6 expects**.
- Fresh full-PR sweep over `4f59fcb666...4bb1c2a45b`: added-line opencode-token grep → **243 lines** (round 4: 245; the −2 is exactly the models-dev.ts fix); URL-pattern grep (`opencode\.ai`, `anomalyco/opencode`, `sst/opencode`, `docs\.opencode`, `models\.opencode`) → **22 lines** (round 4: 24, same reason); per-file bucket counts computed and cross-checked against round-4 classifications; capital-`O` "OpenCode" sweep excluding `@opencode-ai/*` imports and `registerOpencodeSpinner`; targeted sweeps: SDK/OpenAPI added lines (`packages/sdk`, `packages/sdk-next` → 0 opencode hits), CLI added lines (only `registerOpencodeSpinner` imports), prompt-surface files in the diff, `OPENCODE_MODELS_URL` at head (zero non-test/fixture hits).

## Prior-findings verification

### Finding 3 (flagship) — `packages/core/src/models-dev.ts:169,172` — FIXED (main location), but see new finding 8 for the two sibling files

The fix commit restores Kilo's deliberate base default, now annotated:

```
-    const source = Flag.KILO_MODELS_URL || "https://models.opencode.ai"
+    const source = Flag.KILO_MODELS_URL || "https://models.dev" // kilocode_change
     const filepath = path.join(
       Global.Path.cache,
-      source === "https://models.opencode.ai" ? "models.json" : `models-${Hash.fast(source)}.json`,
+      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`, // kilocode_change
     )
```

Resulting state at `4bb1c2a45b` verified directly: line 169 `models.dev`, line 172 `models.dev`, both carrying `// kilocode_change` markers (good for future merges). The default is **models.dev** — Kilo's deliberate pre-merge default (base `4f59fcb666:166` was already `models.dev`; the merge had flipped it to upstream's `models.opencode.ai`). In the full-PR diff the hunk now adds only the markers; the URL value is identical to base, so the flagship rebrand concern is resolved. No new opencode.ai references introduced by the change. Remaining opencode tokens in the file are pre-existing internal identifiers (l.4 `@opencode-ai/schema` import, l.24 `USER_AGENT = opencode/...` context line unchanged since round 1, l.226 code comment) — none added by the PR. This also resolves CONFIG_REGRESSION_V4's flagged observation: merging no longer reverts the base's models.dev default for the runtime CLI catalog. The extension still does not set `KILO_MODELS_URL` (now harmless for the runtime default; see finding 8 for the build-time sibling).

### Finding 1 — `packages/opencode/src/session/prompt/meta.txt` — still FIXED

Regression test re-run and passing (see Methodology). The full-PR diff's prompt-surface file list is unchanged from round 4 (`review.txt`/`tool.txt` are now at the base, not in the PR diff).

### Finding 2 — `packages/http-recorder/package.json` — still FIXED

Not touched by the fix commit; Kilo-Org URLs stand.

### Finding 4 — `packages/storybook/.storybook/mocks/app/context/language.ts` — STILL OPEN (unchanged, still dead code)

Identical OpenCode-branded strings at head (l.25 "Free models provided by OpenCode", l.42/56/64 "models in OpenCode", l.47 "OpenCode Zen gives you access...", l.51 `opencode.ai/zen`); sibling `hooks/use-providers.ts:28-29` still adds "OpenCode Zen"/"OpenCode Go" display names. Dead-code status re-verified and strengthened: `packages/storybook` still has no `src/` (tree listing: only `.storybook/`, package.json, configs, a debug log), and `git grep '@/context/' 4bb1c2a45b -- '*.stories.*'` → exit 1: **no story in the repo imports the aliased mocks** (the one new stories file in the PR, `packages/session-ui/.../prompt-input.stories.tsx`, imports only relative/solid-js modules). Severity unchanged: Low, borderline non-finding.

### Finding 7 — `.changeset/opencode-v1-17-13-to-v1-18-0.md:6` — STILL OPEN (unchanged)

Line 6 still reads `Changes from opencode v1.17.13 to v1.18.0 upstream:` (30-line itemized list); the fix commit does not touch it. Precedent re-verified at head: `.changeset/opencode-v1-17-9-to-v1-17-13.md` present with identical "Changes from opencode v1.17.9 to v1.17.13 upstream:" phrasing. Severity unchanged: Low, human verification; arguably acceptable given shipped precedent.

### Shiki theme-name pointer — STILL PRESENT (unchanged)

`theme: "OpenCode"` still passed at 5 session-ui sites (`components/markdown.worker.ts:42,94,118`, `pierre/index.ts:190`, `pierre/worker.ts:25`) while the theme object has `name: "Kilo"` (`packages/ui/src/context/marked-theme.tsx:4`) and is registered as `"Kilo"` (`marked-theme-register.tsx:9`); `marked.tsx:20` even carries a comment warning not to restore a `registerCustomTheme("OpenCode", …)` block on merges. The fix commit does not touch these files. Still unexecuted — functional pointer, not branding; flag for whoever owns markdown/diff rendering.

## New findings (introduced by the delta)

### 8. `packages/ui/vite.config.ts:50` and `packages/llm/script/recording-cost-report.ts:5` — sibling `models.opencode.ai` flips NOT restored by the fix — LOW (verify; partial fix of finding 3)

Round-1-through-4 finding 3 always named three locations ("same for `packages/ui/vite.config.ts:50` and `packages/llm/script/recording-cost-report.ts:5`"). The fix commit restored only the runtime catalog in `models-dev.ts`. Verified against base and upstream:

- `packages/ui/vite.config.ts:50` — base `4f59fcb666`: `process.env.KILO_MODELS_URL || "https://models.dev"`; PR head: `process.env.KILO_MODELS_URL || "https://models.opencode.ai"` (upstream `a105350812:48` uses `OPENCODE_MODELS_URL || "https://models.opencode.ai"`). The flip is an added/removed pair in the full PR diff, un-annotated (no `kilocode_change` marker). Reachability: **build-time only** — `fetchProviderIcons()` fetches `${url}/api.json` during the `@kilocode/kilo-ui` build to enumerate provider icon keys; not shipped runtime behavior, `KILO_MODELS_URL`-overridable.
- `packages/llm/script/recording-cost-report.ts:5` — base: `"https://models.dev/api.json"`; PR head: `"https://models.opencode.ai/api.json"` (identical to upstream). Reachability: internal dev script pricing LLM test recordings; never ships.

Both are the same merge flip as the flagship (Kilo's deliberate `models.dev` base value reverted to upstream's opencode.ai property), so the round-4 fix is **incomplete relative to finding 3's stated scope**. Severity: Low — neither is end-user runtime and both are env-overridable or internal — but a human should decide whether to restore `models.dev` (with `kilocode_change` markers, matching the models-dev.ts fix) or consciously track upstream here. No other new user-facing OpenCode mentions in the delta: the fix commit's remaining files (`GitOps.ts` env-var scrubbing, `test-cli.ts` catch-warning, `config.ts` `catchTag` refactor, `diff-viewer-file-tree.test.tsx` upstream-assertion restoration) are branding-neutral, and the delta's added lines contain zero opencode content tokens and zero URLs.

## Notable non-findings (fix commit and fresh full-PR sweep)

- **Full-PR sweep stats at the new head** — 243 added opencode-token lines / 22 URL lines (vs 245/24 at round 4; the −2/−2 is exactly the models-dev.ts fix). Per-file bucket list is identical to round 4's minus `packages/core/src/models-dev.ts` (now zero added opencode lines) — every bucket re-confirmed against V4 classifications: `bun.lock`; `models-api.json` fixture (`opencode.ai/zen/go/v1` API/doc URLs are upstream catalog data); `artifacts/glm52-rise-video/` marketing sources (`stats.opencode.ai` tokens, `opencode.ai/data` overlays, "verified: OpenCode Go" comments); `packages/codemode/` private-package docs/fixtures ("as OpenCode does on user cancel", "owned by this OpenCode process"); `tips-view.tsx` dead tips inside the `kilocode_change` block comment (the `/share` opencode.ai and `ghcr.io/anomalyco/opencode` docker lines); `marked-parser.test.ts` and `transform-i18n.test.ts` fixtures ("OpenCode uses opencode serve"); `meta-prompt.test.ts` negative assertions; session-ui v2 components (`@opencode-ai/*` imports only); `registerOpencodeSpinner`/`OpenCodeTheme` internals; `script/upstream/*` merge tooling; `.opencode/command/translate.md` (pre-existing dangling internal command); package.json `@opencode-ai/*` dep lines.
- **Generated SDK/OpenAPI** — `packages/sdk` + `packages/sdk-next` added lines: 0 opencode hits (re-run at this head).
- **CLI surface** — added opencode lines under `packages/opencode/src/cli/` are only `registerOpencodeSpinner` imports/calls (internal identifiers).
- **Prompt surfaces in the PR diff** — `meta.txt` fixed and test-guarded; `packages/storybook/.storybook/mocks/app/context/prompt.ts` (new mock in the diff) contains **no** opencode/kilo brand strings in added lines (spot-checked; exit 1).
- **`OPENCODE_MODELS_URL`** — zero non-test/fixture hits at head; the merge did not resurrect upstream's env var in runtime trees (consistent with CONFIG_REGRESSION_V4).
- **`packages/core/src/models-dev.ts` hunk side changes** — the same full-PR hunk also drops the now-obsolete `kilocode_change start/end` block around `ReasoningOption` ("snatched from upstream v1.18.11") because the merge absorbed it upstream; marker bookkeeping, no branding impact (covered by the markers reports).

## Limitations

- Reachability judged statically; the only test executed was the meta-prompt branding test. TUI, Storybook, extension, and JetBrains UI were not run.
- `models.dev` vs `models.opencode.ai` endpoint behavior (redirects, catalog drift) not network-verified; finding 8 remains a human decision, as does the residual intent question on the two sibling files.
- Finding 7's severity assumes the standard changesets → release-notes pipeline; hand-edited release notes would nullify it. The shipped-precedent argument (v1-17-9 file) was verified in-repo, not against published release notes.
- The shiki theme-name pointer was not executed (no render test run).
- Pre-existing opencode mentions outside the PR diff (e.g. `cli/cmd/account.ts` `console.opencode.ai`, `copilot-gpt-5.txt`) were not exhaustively re-audited — only egregious ones adjacent to reviewed areas are noted (all previously classified unreachable or pre-existing).
