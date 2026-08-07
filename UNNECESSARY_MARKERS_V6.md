# Unnecessary `kilocode_change` Markers — Upstream Merge Review (Round 6, LIGHT)

- **Reviewed PR**: merge of upstream opencode v1.18.13 into Kilo, with round-5 review fixes applied
- **Round 6 reviewed HEAD**: `77246a52cb` (= worktree `HEAD~5`; the top 5 commits `310cc6ae94`, `ffa6b715d7`, `d6464245c3`, `42d15cc3b7`, `89d53296bd` add only the round-1–5 report `.md` files)
- **Delta since round 5**: single commit `77246a52cb` "fix(core): address round 5 review findings for upstream merge" — 6 files: `packages/core/src/repository-cache.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/llm/script/recording-cost-report.ts`, `packages/opencode/src/kilocode/kilo-commands.tsx`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`, `packages/ui/vite.config.ts`
- **PR base**: `4f59fcb666` (unchanged)
- **Upstream tag**: `v1.18.13` = `a105350812`
- **Prior report**: `UNNECESSARY_MARKERS_V5.md` (round 5 head `4bb1c2a45b`)

## Headline answer

**Round 5's sole finding (R5-F1) is fixed, and no new unnecessary markers were introduced.** `diff-viewer-file-tree.test.tsx` is now byte-identical to upstream v1.18.13 with 0 markers — the fix removed exactly the 2 marker comment lines and kept the restored assertions. Better: the file is now also byte-identical to the PR base, so it has **dropped out of the PR diff entirely** (round 5: in-diff; round 6: absent from `git diff --name-only 4f59fcb666...77246a52cb`).

- **New findings: 0**
- **Round-5 finding verification: 1 of 1 fixed**
- **Pre-existing findings re-verified: 4 of 4 still present, still stale, still pre-existing, still outside the PR diff**

## Verification results

### R5-F1 fix: `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` — FIXED

- `git diff a105350812..77246a52cb -- <file>` is **empty** (byte-identical to raw upstream).
- Marker count: **0** at `77246a52cb` (was 2 at `4bb1c2a45b`).
- Fix-commit patch confirms exactly the 2 marker comment lines were deleted (`// kilocode_change start - restore upstream absence assertions` / `// kilocode_change end`); the two upstream assertions remain.
- Net effect on the PR: the file no longer appears in `git diff --name-only 4f59fcb666...77246a52cb` — the round-5/6 fix pair leaves zero net change versus the PR base.

### Delta-file targeted checks (6 files)

| File | Markers @ `77246a52cb` (prev) | vs raw upstream | In PR diff? | Verdict |
|---|---|---|---|---|
| `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` | 0 (2) | **identical** | no (dropped) | R5-F1 fixed |
| `packages/ui/vite.config.ts` | 3 (2) | differs, 3 drift lines | yes | markers on real drift — justified |
| `packages/llm/script/recording-cost-report.ts` | 1 (0) | differs, 1 drift line | yes | marker on real drift — justified |
| `packages/core/src/repository-cache.ts` | 5 (2) | differs | yes | new marker block wraps new Kilo logic — justified |
| `packages/kilo-vscode/src/agent-manager/GitOps.ts` | 0 (0) | upstream-missing | yes | kilo-only path, no marker obligation |
| `packages/opencode/src/kilocode/kilo-commands.tsx` | 0 (0) | upstream-missing | yes | kilocode path, no marker obligation |

### models.dev restores are NOT markers-only

The task question — did the vite.config.ts / recording-cost-report.ts restores add markers to otherwise-upstream-identical files — answers **no** for both:

- **`packages/llm/script/recording-cost-report.ts`**: raw upstream diff is exactly 1 line (`MODELS_DEV_URL` `https://models.opencode.ai/api.json` → `https://models.dev/api.json // kilocode_change`). After stripping the inline marker the URL line still differs from upstream, so the file classifies `small-diff`, not `markers-only`. Context: the file was **byte-identical to upstream at the round-5 head** — the merge had silently regressed Kilo's `models.dev` URL (present at PR base `4f59fcb666`) to upstream's `models.opencode.ai`. The fix restores the base behavior and now marks it. Legitimate drift-marking.
- **`packages/ui/vite.config.ts`**: raw upstream diff is 3 lines, all marker-suffixed — two pre-existing `if (!process.env.KILO_FETCH_PROVIDER_ICONS) return // kilocode_change` early-returns and the restored `process.env.KILO_MODELS_URL || "https://models.dev" // kilocode_change` line (previously `OPENCODE_MODELS_URL` / `models.opencode.ai`). Real drift remains after marker stripping; not `markers-only`.
- **Transform coverage**: no transform touches either file. `grep -rn "models.dev\|models\.opencode\|vite\.config\|recording-cost-report" script/upstream/` → no matches; the transforms dir (`keep-ours`, `lock-files`, `package-names`, `preserve-versions`, `remove-kilo-web`, `skip-files`, `transform-extensions`, `transform-i18n`, `transform-package-json`, `transform-scripts`, `transform-take-theirs`, `transform-web`) contains only one incidental "vite" hit — `@sentry/vite-plugin` in `transform-package-json.ts`'s package.json dependency-deletion list, which does not apply to `vite.config.ts`. So transformed upstream == raw upstream for both files and the drift (and markers) are genuine on both bases. Same verdict pattern as round 5's `models-dev.ts` non-finding.

### `repository-cache.ts` new marker block — legitimate

The fix added a `kilocode_change start/end` block wrapping genuinely **new** Kilo logic (canonicalize `file:` remotes via `fs.resolve` before comparison, for Windows Git rewrites) plus an inline marker on the `match` argument. The wrapped content does not exist upstream in any form — this is the canonical marker use case, the opposite of R5-F1 (which had wrapped upstream-verbatim lines).

### Pre-existing stale-marker files — 4 of 4 unchanged

| File | Markers @ `77246a52cb` | Touched by delta? | In PR diff? |
|---|---|---|---|
| `packages/core/test/session-prompt.test.ts` | 1 | no | no |
| `packages/opencode/src/cli/cmd/run/demo.ts` | 1 | no | no |
| `packages/opencode/src/cli/cmd/run/subagent-data.ts` | 1 | no | no |
| `packages/sdk/js/src/error-interceptor.ts` | 1 | no | no |

Suggested actions unchanged from rounds 1–5 (delete the stale marker comment, or `reset-to-upstream.ts` the file — separate hygiene commit, not this PR).

## New findings

None.

## Limitations

- **Repo-wide finder run skipped** per LIGHT-round instructions. The repo-wide `markers-only` count is therefore not freshly confirmed; expectation (inference, not measurement) is a return to 4 — the 4 pre-existing files above — since the only round-5 `markers-only` addition is now upstream-identical. The `small-diff` classifications asserted for `recording-cost-report.ts` and `vite.config.ts` are derived from strip-basis reasoning (drift lines ≤ 5, non-marker) under the round-5 bucket semantics, not from a fresh finder bucket assignment.
- **Marker-strip replication not rerun** over the full PR marker-file population; targeted checks covered only the 6 delta files plus the 4 known stale files.
- **File granularity**: as in prior rounds, an individually-stale marker inside a file that also carries real drift is not detectable by whole-file comparison; `repository-cache.ts`'s 5 markers were verified at the patch level this round, the other real-drift marker files were not re-inspected.
- No scripts were run in write mode; only `git` reads and `grep` counts were used this round (no finder/resetter invocations at all).
