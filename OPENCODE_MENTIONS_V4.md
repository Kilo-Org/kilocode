# OPENCODE_MENTIONS_V4.md — Round 4: OpenCode branding audit for upstream-merge PR (v1.18.13)

## Scope

Round 1 reviewed head `cce22e608f` (OPENCODE_MENTIONS.md), round 2 `37a5cbf5db` (V2), round 3 `b6505b164b` (V3). Since round 3 the branch merged `origin/johnnyeric/kilo-opencode-v1.18.0` and landed `6d331a726f` "fix(core): address round 3 review findings for upstream merge". Round 4 reviewed head: `b793883de6` (worktree HEAD~3; the three commits on top — `ff0fe973e5`, `628425d8d6`, `596bf49680` — add report files only, verified via `git diff --stat HEAD~3..HEAD`: 21 markdown files, +1794/−0). New PR base: `4f59fcb666` (merge-base with the head, verified). Delta = `git diff b6505b164b..b793883de6` (151 files). Full PR diff = `git diff 4f59fcb666...b793883de6` (422 files). Upstream merged tag: v1.18.13 = `a105350812`.

Questions: (1) are the still-open round-3 findings fixed at the new head — in particular the `.changeset/opencode-v1-18-1-to-v1-18-13.md` wording, which is in the delta, (2) does the delta introduce new user-facing "OpenCode" mentions, (3) did all prior rounds miss anything in the full PR diff.

## Methodology

- Re-checked each round-3 finding's file at `b793883de6` directly (worktree is clean; code identical to reviewed head); re-ran the branding regression test (`bun test ./test/kilocode/session/meta-prompt.test.ts` from `packages/opencode/` — 1 pass, 6 expects).
- Delta sweep: `git diff b6505b164b..b793883de6 | grep -i '^+' | grep -i opencode` → 38 added content lines (after dropping `+++` path headers), every one mapped to its file: all are `@opencode-ai/*` import paths, `bun.lock` entries, `packages/opencode/...` path references in architecture-boundary tooling (`script/architecture-allowlist.json`, `script/check-architecture.ts`), glob patterns, and an `opencodeDir` local in `packages/kilo-vscode/script/local-bin.ts`. URL sweep on the delta (`opencode\.ai`, `anomalyco/opencode`, `sst/opencode`, `docs\.opencode`, `models\.opencode`): **0 hits**.
- High-risk delta areas read individually: `kilocode/review/review.txt`, `kilocode/suggestion/tool.txt`, `kilocode/kilo-commands.tsx`, `kilo-docs/pages/getting-started/settings/sandboxing.md`, `kilo-docs/source-links.md`, all 21 touched `kilo-vscode/webview-ui/src/i18n/*.ts` locale files, `DisplayTab.tsx`, `kilo-ui` tool-approval/basic-tool/message-part components, `.github/workflows/check-opencode-annotations.yml`.
- Fresh full-PR sweep: same greps over `4f59fcb666...b793883de6` → 245 added opencode lines (down from 311 at round 3 — the base moved forward and absorbed shared history), 24 URL-pattern lines, capital-`O` "OpenCode" sweep excluding imports/internal identifiers. Every bucket cross-checked against round-1/2/3 classifications; highest-count buckets (session-ui v2 components, codemode tests) spot-checked line-by-line again.
- Reachability checks: `grep -rn 'KILO_MODELS_URL' packages/kilo-vscode/src/` (exit 1 — extension still does not override the catalog URL), `packages/storybook` still has no `src/` (mocks still dead), `.changeset/opencode-v1-17-9-to-v1-17-13.md` precedent file re-confirmed present, `script/check-workflows.ts:35` still allowlists the annotations workflow.
- LLM-prompt standard applied: per prior rounds, a shipped system prompt claiming OpenCode identity or pointing at opencode.ai docs is a finding (meta.txt precedent); repo file paths and brand-neutral instruction text are not.

## Round-3 verification status

### Finding 1 — `packages/opencode/src/session/prompt/meta.txt` — still FIXED

Verified at new head: line 1 "You are Kilo...", line 56 "# Tool Use – Kilo Specifics", line 64 `github.com/Kilo-Org/kilocode`, line 65 `https://kilo.ai/docs`. Regression test re-run and passing (see Methodology).

### Finding 2 — `packages/http-recorder/package.json` — still FIXED

`homepage`/`bugs` at lines 13-14 remain the Kilo-Org/kilocode URLs.

### Finding 3 — `packages/core/src/models-dev.ts:169,172` — STILL OPEN (unchanged)

`Flag.KILO_MODELS_URL || "https://models.opencode.ai"` untouched by the delta and by the round-3 fix commit; same for `packages/ui/vite.config.ts:50` and `packages/llm/script/recording-cost-report.ts:5` (`MODELS_DEV_URL = "https://models.opencode.ai/api.json"`). Re-verified the VS Code extension does not set `KILO_MODELS_URL` (grep exit 1 over `packages/kilo-vscode/src/`), so all clients still default to the opencode.ai-hosted catalog. Status/severity unchanged: Low, human decision on whether this upstream infra coupling is acceptable.

### Finding 4 — `packages/storybook/.storybook/mocks/app/context/language.ts` — STILL OPEN (unchanged, still dead code)

Identical OpenCode-branded strings (l.25 "Free models provided by OpenCode", l.51 `opencode.ai/zen`, l.42/56/64 "models in OpenCode", l.47 "OpenCode Zen gives you access..."). Sibling mock `hooks/use-providers.ts:28-29` still adds "OpenCode Zen"/"OpenCode Go" display names. `packages/storybook` still has **no `src/` directory** — dead code. Severity unchanged: Low, borderline non-finding.

### Finding 6 — `.changeset/opencode-v1-18-1-to-v1-18-13.md` — FIXED

The delta (fix commit `6d331a726f`) rewrote line 5:

```
-Adopt OpenCode v1.18.1 through v1.18.13 improvements, including model compatibility, MCP reliability, and TUI enhancements.
+Adopt upstream improvements from v1.18.1 through v1.18.13, including model compatibility, MCP reliability, and TUI enhancements.
```

The release-notes text no longer names OpenCode.

### Finding 7 — `.changeset/opencode-v1-17-13-to-v1-18-0.md:6` — STILL OPEN (unchanged)

Line 6 still reads `Changes from opencode v1.17.13 to v1.18.0 upstream:` (30-line itemized list). The delta does not touch this file. Mitigating precedent re-verified: `.changeset/opencode-v1-17-9-to-v1-17-13.md` (present at base, shipped on main) uses the identical "Changes from opencode v1.17.9 to v1.17.13 upstream:" phrasing. Severity unchanged: Low, listed for human verification; arguably acceptable given precedent. (Line-number correction vs V3, which cited :5 — the string is on line 6.)

### Shiki theme-name pointer — STILL PRESENT (unchanged)

`packages/session-ui` consumers still pass `theme: "OpenCode"` (`components/markdown.worker.ts:42,94,118`, `pierre/index.ts:190`, `pierre/worker.ts:25`) while the theme object has `name: "Kilo"` (`packages/ui/src/context/marked-theme.tsx:4`) and is registered as `"Kilo"` (`marked-theme-register.tsx:9`, `registerCustomTheme("Kilo", ...)`). Note `packages/ui/src/context/marked.tsx:532,660` correctly uses `theme: "Kilo"`, so session-ui remains the outlier. The delta does not touch any of these files (only `marked-code-span.ts`, which gained a `// kilocode_change - new file` header). Still unexecuted — functional pointer, not branding; flag for whoever owns markdown/diff rendering.

## New findings (introduced by the delta)

**None.** The 151-file delta adds zero user-facing OpenCode strings and zero opencode URL references. All 38 added opencode-token lines are internal identifiers (imports, lockfile, repo paths in architecture tooling). The two new LLM-facing prompt files pass the meta.txt standard:

- `packages/opencode/src/kilocode/review/review.txt:1` — "You are Kilo Code, an expert code reviewer..." (correct identity). Its only opencode token is l.42's repo path `packages/opencode/src/kilocode/review/review.ts` — an internal identifier (the directory is literally named `packages/opencode`), not product branding. The delta's review.txt changes are brand-neutral scope documentation (`staged`/`unpushed` modes, effort flags).
- `packages/opencode/src/kilocode/suggestion/tool.txt` — fully brand-neutral ("Use this tool to suggest a local code review..."); zero kilo/opencode tokens. The delta only adjusts `/review` action-prompt wording.

## Notable non-findings (delta and full-PR sweep)

- **`packages/kilo-vscode/webview-ui/src/i18n/*.ts` (21 locales: en + ar, br, bs, da, de, es, fa, fr, it, ja, ko, nl, no, pl, ru, th, tr, uk, zh, zht)** — zero opencode tokens in added lines across all 21 files. en.ts additions are neutral UI strings ("Show Auto-Approval Reason", sandbox DNS description).
- **`packages/kilo-docs/pages/getting-started/settings/sandboxing.md`** — fully Kilo-branded (29 Kilo mentions, 0 opencode); documents the new sandbox settings.
- **`packages/kilo-docs/source-links.md`** — added entries are `packages/opencode/src/...` file paths inside HTML comments (source-link extraction tooling; the package directory name is a repo identifier, not branding). One added docs link points at `github.com/anthropics/claude-code/issues/31375` — external reference, not OpenCode branding.
- **`.github/workflows/check-opencode-annotations.yml`** — delta adds one CI step (`check-architecture.ts`). CI-only, still allowlisted in `script/check-workflows.ts:35`; no user-facing output.
- **`packages/opencode/src/kilocode/kilo-commands.tsx` / `plugins/sidebar-footer.tsx`** — round-3 fix plumbing (privacy-mode config scope); strings remain Kilo-branded ("Privacy Mode Enabled", category "Kilo").
- **`DisplayTab.tsx`, `kilo-ui` `tool-approval.tsx` / `basic-tool.tsx` / `message-part.tsx` / `lucide.ts` / `basic-tool.css`** — auto-approval-reason display feature; zero opencode/kilo brand tokens in added lines (neutral UI text, icons, CSS).
- **New delta changesets** (`command-model-selector-sync`, `fix-agent-manager-terminal-toggle`, `fix-multi-project-agent-manager-tool`, `fix-secondary-sidebar-nav-bar`, `fix-tool-approval-source-display`, `narrow-agent-manager-terminal`, `narrow-sidebar-recent`, `optimize-review-slash-commands`, `sandbox-live-settings`) — all Kilo-branded or neutral; none name OpenCode.
- **Full-PR sweep buckets, all re-confirmed as prior classifications** — `bun.lock`; `models-api.json` fixture (upstream catalog data: `opencode.ai/zen/go/v1` API/doc URLs); `artifacts/glm52-rise-video/` upstream marketing sources (`stats.opencode.ai` design tokens, "OpenCode Go" verification comments); `packages/codemode/` private-package docs/fixtures ("as OpenCode does on user cancel", "owned by this OpenCode process"); `tips-view.tsx` dead tips inside the `kilocode_change` block comment; `marked-parser.test.ts` and `transform-i18n.test.ts` fixtures; `meta-prompt.test.ts` negative assertions (`not.toContain("You are OpenCode")`); session-ui v2 components (`@opencode-ai/ui/*` imports only); `registerOpencodeSpinner`/`OpenCodeTheme` internals; `script/upstream/*` merge tooling; `.opencode/command/translate.md` (pre-existing dangling internal command); SDK/client/schema generated files (0 opencode hits in the delta).
- **kilo-jetbrains** — not in the delta; nothing to re-check beyond V3's clean classification.

## Limitations

- Reachability judged statically; the only test executed was the meta-prompt branding test. TUI, Storybook, extension, and JetBrains UI were not run.
- `models.opencode.ai` vs `models.dev` behavior not network-verified; finding 3 remains a human decision.
- Finding 7's severity assumes the standard changesets → release-notes pipeline; hand-edited release notes would nullify it. The shipped-precedent argument (v1-17-9 file) was verified in-repo, not against published release notes.
- The shiki theme-name pointer was not executed (no render test run).
- Pre-existing opencode mentions outside the PR diff (e.g. `cli/cmd/account.ts` `console.opencode.ai`, `copilot-gpt-5.txt`) were not exhaustively re-audited — only egregious ones adjacent to reviewed areas are noted (all previously classified unreachable or pre-existing).
