# Unnecessary `kilocode_change` Markers — Upstream Merge Review

- **Reviewed PR**: merge of upstream opencode v1.18.13 into Kilo
- **Reviewed HEAD**: `cce22e608f056bbd6e33ad914b6bf47361a309f0` (= worktree HEAD, clean tree)
- **Pre-merge Kilo base**: `b135b4e10a` (PR diff = 390 files)
- **Upstream tag**: `v1.18.13` = `a105350812f05f914c768e468559dbd6bd508d8e` (ancestor of HEAD, resolved locally; `.opencode-version` pins `v1.18.13`)

## Question

Do any merged files still carry `kilocode_change` markers without any actual difference to upstream?

**Headline answer: no unnecessary markers were introduced or left behind by this PR.** Of the 390 files in the PR diff, zero files are identical to upstream while carrying markers. The only 4 files repo-wide whose entire drift from upstream consists of marker comments are **pre-existing** (untouched by this PR) and are listed as findings below for optional cleanup.

## Methodology

### Scripts (read first, then run with `--dry-run` only)

- `script/upstream/find-reset-candidates.ts [path] [--dry-run] [--review-limit n] [--concurrency n]` — pre-filters with `git diff --name-only <last-merged-upstream>..HEAD` (excluding kilo-only paths `packages/kilo-*/**`, `**/kilocode/**`, `script/upstream`, plus non-code assets and `keepOurs`/`skipFiles` policy files), then classifies each file against **transformed** upstream (branding/package-name/i18n transforms applied). The `markers-only` bucket = "stripping `kilocode_change` markers makes local match upstream" — exactly this report's core finding type.
- `script/upstream/reset-to-upstream.ts <file> --dry-run` — per-file verification; prints `[DRY-RUN] Would reset ...` when local differs from transformed upstream, `already matches` when identical.
- Upstream ref resolution: both scripts call `last()` in `script/upstream/utils/upstream.ts`, which reads `.opencode-version` (contains `v1.18.13`) and resolves the tag locally via `git rev-parse --verify v1.18.13^{commit}` → `a105350812...`. No network access was needed or used.

### Invocations

```
bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 1   # full repo scan, report only
bun run script/upstream/reset-to-upstream.ts <file> --dry-run                # per-finding verification
git diff --name-only b135b4e10a..HEAD                                        # 390 PR files (cross-reference)
git diff a105350812..HEAD -- <path>                                          # raw upstream diff per file
```

Note on `--concurrency 1`: two runs at the default concurrency (8) reproducibly hung after logging `Classified 872/872` (idle `bun` process, no git children, report never printed — looks like a Bun subprocess stall in this environment). The serial run completed with `EXIT=0` and produced the report below. Classification progress and candidate counts were identical across all runs.

### Scan output (serial run, dry-run)

```
[OK] Last merged upstream: v1.18.13 (a1053508)
[INFO] Scope: (all shared paths)
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 342 non-code asset(s)
[INFO] Skipping 2105 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1247
[INFO] Pre-bucketed 375 (missing or too-large)
[INFO] Classifying 872 file(s)...
[INFO] Classified 872/872

| Bucket | Count | Action |
|---|---|---|
| markers-only | 4 | would reset |
| cosmetic-only | 2 | would reset |
| small-diff | 197 | would reset |
| large-diff | 487 | skipped |
| identical | 182 | nothing to do |
| upstream-missing | 375 | skipped |
```

### Independent cross-checks (not relying on the scripts)

1. Grepped all 390 PR files at HEAD for `kilocode_change` → **101 marker files**.
2. For each: `git diff a105350812..HEAD -- <path>` — none was empty (a file with marker comment lines always differs from raw upstream, which has none).
3. Byte-identity sweep: **215 of the 390 PR files are byte-identical to raw upstream**; grepped all 215 → **0 contain markers**. So the "identical to upstream WITH leftover markers" combination does not exist in the PR.
4. Marker-stripping replication (perl implementation of `utils/markers.ts` `clean()` semantics) over the 101 marker files: 0 became byte-identical to **raw** upstream after stripping; 95 retain real diffs; 6 are kilo-only (absent upstream).
5. The script compares against **transformed** upstream, so it additionally catches files whose only residual drift is markers on top of transform-covered branding changes (raw diff non-empty, stripped-vs-transformed equal). All 4 findings below are of this type or pure-comment type, and each was re-confirmed by calling `classifyDrift()` directly.

## Findings

All 4 findings are repo-wide `markers-only` files from the scan. **None of them is in the PR diff** (`git diff b135b4e10a..HEAD -- <file>` empty for all four; each had exactly 1 marker line at base and still has exactly 1 at HEAD). They are pre-existing stale markers, not merge regressions — flagged for optional cleanup, ideally in a separate hygiene commit rather than this PR.

### 1. `packages/core/test/session-prompt.test.ts` — 1 marker

- **Evidence**: raw `git diff a105350812..HEAD` shows a single added line and nothing else:
  ```diff
  +// kilocode_change - no durable interrupt lookup: released database readers cannot decode that event type.
   describe("SessionV2.prompt", () => {
  ```
- Independent check: stripping the marker yields **byte-equality with raw upstream** (verified with perl strip + `diff`, and with `classifyDrift()` → `markers-only`).
- `reset-to-upstream.ts --dry-run`: `[DRY-RUN] Would reset packages/core/test/session-prompt.test.ts to transformed upstream v1.18.13`.
- The explanatory comment documents a Kilo difference that no longer exists in the file.
- **Suggested action**: delete the comment line (or run `bun run script/upstream/reset-to-upstream.ts packages/core/test/session-prompt.test.ts`).

### 2. `packages/opencode/src/cli/cmd/run/demo.ts` — 1 marker

- **Evidence**: entire raw diff vs upstream is the import line:
  ```diff
  -import type { Event, ToolPart } from "@opencode-ai/sdk/v2"
  +import type { Event, ToolPart } from "@kilocode/sdk/v2" // kilocode_change - revert to upstream native Event type
  ```
- The `@opencode-ai/sdk` → `@kilocode/sdk` rewrite is exactly what the merge automation's package-name transform produces (`script/upstream/transforms/package-names.ts`, import rule with subpath support). After transforms, the code matches upstream; only the inline marker comment remains (`classifyDrift()` → `markers-only`).
- `reset-to-upstream.ts --dry-run`: `[DRY-RUN] Would reset ...`.
- The marker's stated intent ("revert to upstream native Event type") is already satisfied by the transform; the marker is noise.
- **Suggested action**: drop the `// kilocode_change ...` tail on the import line (or reset the file).

### 3. `packages/opencode/src/cli/cmd/run/subagent-data.ts` — 1 marker

- Identical pattern to finding 2: inline marker on the `@opencode-ai/sdk/v2` → `@kilocode/sdk/v2` import; transform already covers it; `classifyDrift()` → `markers-only`; dry-run reset confirms.
- **Suggested action**: drop the inline marker (or reset the file).

### 4. `packages/sdk/js/src/error-interceptor.ts` — 1 marker

- **Evidence**: entire raw diff vs upstream:
  ```diff
  -  return new Error(`opencode server ${describe(request, response)}: ${reason}`, {
  +  // kilocode_change
  +  return new Error(`kilo server ${describe(request, response)}: ${reason}`, {
  ```
- The `opencode server` → `kilo server` string change is reproduced by the merge branding transforms: verified empirically that marker-stripped local === marker-stripped **transformed** upstream (`translate()` + `clean()` from the script utils → `true`), and `classifyDrift()` → `markers-only`.
- `reset-to-upstream.ts --dry-run`: `[DRY-RUN] Would reset ...`.
- **Suggested action**: remove the standalone `// kilocode_change` line (or reset the file — the reset output keeps the `kilo server` string because it reapplies the branding transform).

## Notable non-findings

- **215 PR files are byte-identical to raw upstream v1.18.13 and none contains markers** (verified by grepping all 215, not a sample). The merge cleanly synchronized these files.
- **3 of those 215 still had markers at the pre-merge base**; the merge correctly dropped marker + dead drift together: `packages/opencode/test/account/service.test.ts`, `packages/opencode/test/mcp/oauth-browser.test.ts`, `packages/session-ui/src/components/markdown-worker.ts`. (Worth a human glance only to confirm the dropped Kilo deltas were intentionally upstreamed/abandoned — content-wise the files now equal upstream.)
- **29 further PR files are identical to transformed upstream** (script `identical` bucket; raw diffs are branding-only) — no markers in any of them (all 182 repo-wide `identical` files grepped, 0 hits).
- **95 PR files carry markers AND real diffs** — markers justified: 84 in `large-diff`, 11 in `small-diff` (≤5 non-marker drift lines: `packages/codemode/tsconfig.json` (4), `packages/core/src/session/compaction.ts` (1), `packages/core/src/session/runner/llm.ts` (4), `packages/opencode/src/effect/runtime-flags.ts` (5), `packages/opencode/test/provider/header-timeout.test.ts` (5), `packages/session-ui/src/v2/components/prompt-input/index.tsx` (4), `packages/tui/src/ui/dialog.tsx` (2), `packages/ui/src/components/resize-handle.tsx` (3), `packages/ui/src/components/select.css` (1), `packages/ui/src/styles/theme.css` (4), `packages/ui/vite.config.ts` (4)). These 11 are close enough to upstream that a future pass could try to eliminate the drift (and thus the markers), but each contains genuine Kilo changes today — e.g. `compaction.ts` adds a real `include: selected.recent,` field and `select.css` a real `max-width` rule, both with inline markers. A naive "diff lines containing kilocode_change" heuristic flagged these two as marker-only; manual inspection showed the marker lines also add code. Not findings.
- **6 PR marker files are kilo-only** (absent upstream): `packages/opencode/src/kilocode/tool/task.ts`, `packages/opencode/src/provider/models.ts`, `script/check-model-tool-network.ts`, `script/upstream/README.md`, `script/upstream/merge.ts`, `script/upstream/transforms/transform-package-json.ts`. Markers expected/harmless here (kilo-owned paths; the script excludes or upstream-missing-buckets them).
- Repo-wide `cosmetic-only` bucket (whitespace/reordering only): `packages/opencode/src/session/prompt/anthropic.txt`, `patches/effect@4.0.0-beta.83.patch` — neither is in the PR and neither involves markers; listed only because the script would auto-reset them.

## Limitations

- **Transformed vs raw comparison**: the scripts compare against upstream *after* Kilo branding/package-name/i18n transforms. A raw `git diff a105350812..HEAD -- <file>` can be non-empty (branding) while the file is nevertheless `markers-only`/`identical` for reset purposes. Findings above state which basis was used; all 4 were confirmed on the transformed basis and re-confirmed via direct `classifyDrift()` calls.
- **File granularity**: buckets classify whole files. A file with both real diffs and an individually-stale marker (marking a region that now matches upstream) would not be caught here; detecting that needs per-marker rebuilds (`bun run script/upstream/fix-kilocode-markers.ts <file> --dry-run`) across the 95 real-diff marker files — not performed in this pass. Flagged for human discretion.
- **Skipped populations**: 375 pre-bucketed files (`upstream-missing` = kilo-only, or `too-large` > 256 KB, e.g. generated manifests) were not content-classified. No PR marker file fell into `too-large`, so this does not affect the marker question; `upstream-missing` files are kilo-only by definition.
- **Marker-unsupported extensions**: the stripper has no comment style for `.json`; the inline `// kilocode_change` in `packages/codemode/tsconfig.json` is counted as ordinary drift (lands in `small-diff`). That file has real config changes regardless, so no finding is missed.
- **Environment**: default-concurrency runs of the finder hung in this sandbox (see Methodology); results come from the completed serial dry-run. No writes were performed at any point (`--dry-run` everywhere; worktree remained clean throughout).
