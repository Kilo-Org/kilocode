# OPENCODE_MENTIONS_V6.md — Round 6 (LIGHT): OpenCode branding verification for upstream-merge PR (v1.18.13)

## Scope

Round 6 reviewed head: `77246a52cb` (worktree HEAD~5; the five commits on top add report files only). Previous round head: `4bb1c2a45b`. PR base re-verified: `git merge-base 4f59fcb666 77246a52cb` → `4f59fcb666` (unchanged). Delta since round 5 = single commit `77246a52cb` "fix(core): address round 5 review findings for upstream merge" (6 files, +29/−12: `packages/core/src/repository-cache.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/llm/script/recording-cost-report.ts`, `packages/opencode/src/kilocode/kilo-commands.tsx`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`, `packages/ui/vite.config.ts`). LIGHT round: verify V5 finding 8 fix, re-verify carried findings, grep the delta; full-PR sweep intentionally skipped.

## Verification results

### V5 Finding 8 — `packages/ui/vite.config.ts:50` + `packages/llm/script/recording-cost-report.ts:5` — FIXED

Both sibling `models.opencode.ai` flips are restored to Kilo's deliberate base values, now annotated:

- `packages/ui/vite.config.ts:50` at head: `const url = process.env.KILO_MODELS_URL || "https://models.dev" // kilocode_change` — matches base `4f59fcb666` value, marker added appropriately (shared upstream file).
- `packages/llm/script/recording-cost-report.ts:5` at head: `const MODELS_DEV_URL = "https://models.dev/api.json" // kilocode_change` — matches base value, marker added.
- Head-tree sweep: `git grep -i 'models\.opencode\.ai' 77246a52cb -- packages/` → **exit 1, zero hits**. Round-1 finding 3's full stated scope (all three locations) is now resolved.

### Delta content check — `kilo-commands.tsx` and `repository-cache.ts` — CLEAN

- `kilo-commands.tsx`: `/privacy` toggle now also unsets project-level `privacy_mode` when disabling (second `overlayUpdate` with `unset: ["privacy_mode"]`, `Promise.all`, consolidated error path). The only user-facing string in the hunk is the pre-existing toast `` `Failed to update privacy mode (${status})` `` — wording unchanged, **no opencode mentions, no new brand strings**.
- `repository-cache.ts`: restores `fs.resolve` canonicalization for file remotes rewritten by Git on Windows, correctly wrapped in `// kilocode_change start/end` (shared file). No user-facing strings at all.
- Other delta files: `GitOps.ts` adds `delete env.GIT_EXEC_PATH` / `delete env.PREFIX` (branding-neutral); `diff-viewer-file-tree.test.tsx` removes the `kilocode_change start/end` pair around restored upstream absence assertions (unnecessary-marker cleanup — markers-lens concern, branding-neutral).

### Delta grep — CLEAN

`git diff 4bb1c2a45b..77246a52cb | grep -i '^+' | grep -i opencode` → only the `+++ b/packages/opencode/src/kilocode/kilo-commands.tsx` path header; **zero** added content lines with opencode tokens. URL-pattern grep (`opencode.ai`, `anomalyco`, `opencode-ai`, `docs.opencode`) over added lines → **exit 1, zero hits**.

### Carried findings — re-verified at `77246a52cb`, ALL STILL OPEN (unchanged)

1. **Storybook i18n mocks (dead code)** — `packages/storybook/.storybook/mocks/app/context/language.ts` still carries OpenCode-branded strings (l.25 "Free models provided by OpenCode", l.42/56/64 "models in OpenCode", l.47 "OpenCode Zen gives you access...", l.51 `opencode.ai/zen`); sibling `hooks/use-providers.ts:28-29` still adds "OpenCode Zen"/"OpenCode Go" display names. Dead-code status re-confirmed: `packages/storybook` still has no `src/`, and `git grep '@/context/' 77246a52cb -- '*.stories.*'` → exit 1 (no story imports the aliased mocks). Severity unchanged: Low, borderline non-finding.
2. **`.changeset/opencode-v1-17-13-to-v1-18-0.md:6`** — still reads `Changes from opencode v1.17.13 to v1.18.0 upstream:`; not touched by the delta. Severity unchanged: Low, human verification; shipped-precedent argument from V5 (`opencode-v1-17-9-to-v1-17-13.md`) still applies.
3. **Session-ui shiki `theme: "OpenCode"` vs registered `"Kilo"`** — unchanged: `theme: "OpenCode"` still passed at 5 sites (`markdown.worker.ts:42,94,118`, `pierre/index.ts:190`, `pierre/worker.ts:25`) while the theme object has `name: "Kilo"` (`marked-theme.tsx:4`) and is registered as `"Kilo"` (`marked-theme-register.tsx:9`); `marked.tsx:20` still carries the do-not-restore comment. Functional pointer, not branding; still unexecuted.

## New findings

None. The delta introduces no user-facing or non-user-facing OpenCode mentions, no URLs, and no brand-adjacent string changes.

## Limitations

- **Full-PR sweep skipped** per LIGHT-round instructions; per-file bucket classifications from V5 were not recomputed at this head. The V5 sweep state (243 added opencode-token lines / 22 URL lines, all classified) stands minus nothing — the delta only removed content elsewhere and added none.
- Reachability judged statically; no tests run this round (delta is branding-neutral; the round-5 meta-prompt branding test result still stands, unaffected files).
- The three carried findings remain human-decision items as documented in V5.
