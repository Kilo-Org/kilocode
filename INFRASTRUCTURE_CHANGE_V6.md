# Infrastructure Change Review V6 — upstream v1.18.13 merge (round 6, LIGHT)

Reviewed HEAD: `77246a52cb` (worktree HEAD is `89d53296bd`; the top 5 commits are report-only docs — verified `git diff 77246a52cb..HEAD --name-only` lists only the 35 `*.md` report files, so the checkout matches the reviewed head for all repo content). PR base: `4f59fcb666` (ancestor; `git merge-base` returns the base). Round-6 delta: single commit `77246a52cb` "fix(core): address round 5 review findings" (6 files: `packages/core/src/repository-cache.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/llm/script/recording-cost-report.ts`, `packages/opencode/src/kilocode/kilo-commands.tsx`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`, `packages/ui/vite.config.ts`). Upstream tag: `v1.18.13` = `a105350812`. Prior reports: `INFRASTRUCTURE_CHANGE.md` … `_V5.md`.

## Scope

Light round per tasking: (1) classify the 6 delta files for infra relevance, (2) re-verify the 3 carried open items, (3) re-run only the fast guard `check-workflows.ts`. Full-PR sweep and the rest of the guard stack intentionally skipped (see Limitations).

## Verification results

### Delta file classification — no infra defects

- **`packages/ui/vite.config.ts`** (build config — inspected): the only change is the `fetchProviderIcons()` default URL restored to `https://models.dev` (from upstream's `https://models.opencode.ai`) with a `// kilocode_change` marker, matching the round-5 `models-dev.ts` re-pin policy. Confirmed via `git diff a105350812` that the file's full Kilo delta vs upstream is exactly the two `KILO_FETCH_PROVIDER_ICONS` early-return gates plus this URL/env-var rename (`KILO_MODELS_URL` vs `OPENCODE_MODELS_URL`), all previously assessed and marker-annotated. The fetch is a dev-server/build-time provider-icon scrape, gated off by default; no CI impact.
- **`packages/llm/script/recording-cost-report.ts`** (internal script — inspected): same one-line URL restore to `https://models.dev/api.json` with a new `// kilocode_change` marker. Verified it is a **shared upstream file** (exists at `a105350812`, where upstream commit `a4f25a94b4` flipped the URL to `models.opencode.ai`), so the marker is required and present. Grep confirms no references from `.github/`, any `package.json` script, or `script/` — it is a manual dev utility, not wired into CI.
- **Other four files are runtime/test code, confirmed non-infra:** `repository-cache.ts` (core runtime; canonicalizes `file:` remotes via `fs.resolve` before comparison, wrapped in a new `kilocode_change start/end` block), `GitOps.ts` (kilo-owned extension runtime; deletes two more env vars — `GIT_EXEC_PATH`, `PREFIX` — in `nonInteractiveEnv()`), `kilo-commands.tsx` (`kilocode/` path, marker-exempt; `/privacy` toggle now also unsets project-scope `privacy_mode` when disabling), `diff-viewer-file-tree.test.tsx` (test-only; removes the round-5 marker block — verified the file is now **byte-identical to upstream** (`git diff a105350812 -- <file>` empty), so marker removal is correct; marker-policy detail belongs to the markers track).

### Carried open items — all unchanged

| Item | State at `77246a52cb` |
|---|---|
| V3-1 `patches/ghostty-web@0.3.0.patch` orphan | **STILL OPEN** — undeclared in root `package.json` (0 `ghostty` matches), still on disk, `kilo-console` still pins `ghostty-web@0.4.0`. Pre-existing on main. |
| Finding 3 `artifacts/` skip-list policy | **STILL OPEN** — `grep '"artifacts' script/upstream/utils/config.ts` no-match; sync-vs-exclude remains a human call. |
| Finding 4 `.opencode/command/translate.md` orphan | **STILL OPEN** — still `model: opencode/gpt-5.6-sol` (inert upstream provider ref). |

### Fast guard

| Command | Result |
|---|---|
| `bun run script/check-workflows.ts` | `check-workflows: ok (29 workflows)`, exit 0 |

## New findings

**None.** The round-6 delta touches no new infrastructure surface; both build-adjacent changes (`vite.config.ts`, `recording-cost-report.ts`) are the same models.dev URL restore already policy-approved in round 5, correctly marker-annotated on shared files.

## Limitations

- Full-PR sweep skipped this round per tasking (V5 swept the 422-file diff green; the delta adds no new paths).
- Guard stack limited to `check-workflows.ts`; `check-architecture.ts`, `check-opencode-annotations.ts` (both modes), `check-test-ci.ts`, `bun install --frozen-lockfile`, and `bun test ./script` were last run green at V5 head `4bb1c2a45b` and were not re-run. The delta touches no workflows, architecture-ratchet boundaries, lockfile, or script tests, so regression risk from skipping is minimal.
- No builds executed; GitHub PR/CI state not inspected.
- Functional review of the runtime changes (repository-cache canonicalization, GitOps env scrubbing, privacy-mode toggle) belongs to the other review tracks; verified here only for infra relevance and marker compliance.
- Review ran at worktree HEAD `89d53296bd` after verifying the top 5 commits touch only report files; no repository files modified other than this report; nothing committed.
