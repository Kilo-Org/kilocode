# Unnecessary `kilocode_change` marker review for PR #11090

## Result

The reviewed PR introduces one complete file whose only difference from the repository's transformed upstream baseline is `kilocode_change` comments:

- `packages/opencode/src/mcp/oauth-provider.ts:47` and `packages/opencode/src/mcp/oauth-provider.ts:48` are a confirmed marker-only reset candidate. Pristine upstream contains `OpenCode` and `https://opencode.ai`; the mandatory merge branding transform produces the current `Kilo` and `https://kilo.ai` values exactly. Removing the two inline markers makes the file byte-identical to transformed upstream v1.15.4. Both `reset-to-upstream.ts --dry-run` and `fix-kilocode-markers.ts --dry-run` confirm that the file would change.

A marker-aware region scan found another 31 exact-upstream inline or block regions in 13 PR-changed shared files. Those files also contain real Kilo differences, so they must not be reset wholesale. Only the stale marker annotations identified below are removal candidates.

Eight additional markers are attached to comments or closing delimiters while nearby code still differs from upstream. Those are human-verification findings: the markers should be moved or re-bounded, not blindly removed.

## Scope and methodology

- Reviewed PR: `#11090`, complete `origin/main...HEAD` range.
- Reviewed head: `6a1377abaa88902b741f3ffff276aa6b743f3a3c`.
- Base and merge base: `b90ab85c3b4ad5097fe11e431d0319f31f935d6e`.
- Pristine upstream: tag `v1.15.4`, commit `2b92c5677e830e95d34fc3d5664a69297d2d0b51`.
- The PR changes 270 files. Of those, 107 contain `kilocode_change` at HEAD, and 89 are shared rather than exempt Kilo-owned paths.
- Ran the required `bun run script/upstream/find-reset-candidates.ts --dry-run`. The default-concurrency run repeatedly reached `Classified 602/602` but did not emit its report before timeout. A serial retry with `--concurrency 1` completed and reported four repository-wide marker-only files. Intersecting those with the PR leaves only `packages/opencode/src/mcp/oauth-provider.ts`.
- Reclassified all 89 PR-changed shared marker-bearing files with the same `classifyDrift` helper used by the finder: 1 marker-only, 16 small-diff, 61 large-diff, and 11 upstream-missing.
- Verified every PR-intersecting marker-only or small-diff finder candidate individually with the documented syntax `bun run script/upstream/reset-to-upstream.ts <path> --dry-run`.
- To catch marker-only regions hidden inside files with larger real diffs, compared marker-cleaned HEAD with branding-transformed upstream using the repository's `translate`, `clean`, and `changed` helpers. This scanned all 78 PR-changed shared marker files that exist upstream. It then inspected plain standalone markers separately because those comments are intentionally removed by `clean` and therefore do not appear in the normal inline/block maps.
- No reset, checkout, source edit, or git mutation was performed.

## Confirmed candidates

### Whole-file marker-only candidate

- `packages/opencode/src/mcp/oauth-provider.ts:47` and `packages/opencode/src/mcp/oauth-provider.ts:48`: the finder classifies the file as `markers-only`. The non-marker content exactly matches transformed upstream. This is the only repository-wide `markers-only` result touched by the PR.

### Stale transform-covered markers inside files with other differences

These marked lines exactly match the transformed upstream baseline. The marker is unnecessary even though another part of the same file may still contain a real Kilo delta.

- `packages/opencode/src/acp/agent.ts:547` and `packages/opencode/src/acp/agent.ts:573`: `Kilo Login` and `Kilo` are the exact branding-transform output.
- `packages/opencode/src/cli/cmd/github.ts:491` and `packages/opencode/src/cli/cmd/github.ts:752`: the Kilo share and API URLs are the exact transformed upstream values.
- `packages/opencode/src/cli/cmd/run.ts:206`: the `kilo server` help text is the exact transformed upstream value.
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx:236`, `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx:241`, `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx:243`, and `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx:244`: all four Kilo-branded tips are produced by the transform.
- `packages/opencode/src/config/managed.ts:36`: the `KILO_TEST_MANAGED_CONFIG_DIR` form matches transformed upstream.
- `packages/opencode/src/config/paths.ts:27` and `packages/opencode/src/config/paths.ts:39`: the two `KILO_*` flag references match transformed upstream. The file's separate `.kilocode` and `.kilo` directory additions remain real Kilo differences, so resetting the file would be incorrect.
- `packages/opencode/src/file/watcher.ts:19`, `packages/opencode/src/file/watcher.ts:37`, and `packages/opencode/src/file/watcher.ts:76`: the `KILO_LIBC`, watcher package expression, and `KILO_EXPERIMENTAL_DISABLE_FILEWATCHER` forms match transformed upstream. The separate `if (err) return` change remains a real Kilo difference.
- `packages/opencode/test/provider/provider.test.ts:103`: `@kilocode/plugin` is the exact package-name-transform output.

### Stale markers where upstream now contains the same behavior

These regions match transformed v1.15.4 without relying only on a branding token replacement.

- `packages/opencode/script/build.ts:288`: the marked bunfs comment is identical upstream text.
- `packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx:320`: upstream now has the same `title: "rename"` line.
- `packages/opencode/src/session/prompt.ts:59`: the marked Effect import is now identical to upstream.
- `packages/opencode/src/session/prompt.ts:966`, `packages/opencode/src/session/prompt.ts:1178`, `packages/opencode/src/session/prompt.ts:2268`, and `packages/opencode/src/session/prompt.ts:2302`: upstream now uses the same `currentModel(...)` calls.
- `packages/opencode/src/session/prompt.ts:1017`, `packages/opencode/src/session/prompt.ts:1044`, `packages/opencode/src/session/prompt.ts:1140`, and `packages/opencode/src/session/prompt.ts:1682`: the complete marked shell-event, persisted-model helper, and prompted/synthetic event blocks contain no remaining difference from transformed upstream.
- `packages/opencode/src/session/session.ts:651` and `packages/opencode/src/session/session.ts:731`: upstream now has the same sync publish option and explicit workspace override.
- `packages/opencode/test/question/question.test.ts:1` and `packages/opencode/test/question/question.test.ts:7`: the marked test imports now match upstream exactly. Other lines in the test still differ.

## Human-verification findings

These are suspicious marker-only placements, but adjacent code is genuinely different from upstream. Removing the marker without relocating it would leave the Kilo delta unannotated.

- `packages/opencode/src/effect/bridge.ts:38`: the standalone marker follows the Kilo-specific `restore(captured.instance, captured.workspace, ...)` line at `packages/opencode/src/effect/bridge.ts:37`.
- `packages/opencode/src/session/compaction.ts:152`: the marker is on an unchanged closing brace, while `outputTokenMax` changes the signature at `packages/opencode/src/session/compaction.ts:147`.
- `packages/opencode/src/skill/index.ts:272`: the marker is on the unchanged call delimiter, while the Kilo runtime-flag and worktree arguments are above it.
- `packages/opencode/src/snapshot/index.ts:306`: the standalone marker follows the Kilo-specific `opts` parameter at `packages/opencode/src/snapshot/index.ts:305`.
- `packages/opencode/src/tool/shell.ts:316`: the standalone explanatory marker is inside the options object, while the encoded PowerShell argument change is at `packages/opencode/src/tool/shell.ts:315`.
- `packages/opencode/test/cli/cmd/tui/sync-undefined-messages.test.tsx:42`: the marker is on the unchanged closing delimiter for a Kilo-specific `provideTestInstance` wrapper.
- `packages/opencode/test/server/httpapi-config.test.ts:63`: the standalone marker is inside the assertion object, while the Kilo-specific `opencode.json` path is at `packages/opencode/test/server/httpapi-config.test.ts:62`.
- `packages/ui/src/components/markdown.tsx:268`: the standalone marker follows the Kilo-specific `Promise<Rendered>` signature at `packages/ui/src/components/markdown.tsx:267`.

The standalone-marker scan found other comments preceding real Kilo blocks. They were inspected but are not reported as unnecessary because the nearby code still differs and the PR did not make the placement newly misleading.

## Notable non-findings

- The other repository-wide marker-only results, `packages/opencode/src/cli/cmd/run/permission.shared.ts`, `packages/opencode/src/cli/cmd/tui/component/error-component.tsx`, and `packages/sdk/js/src/error-interceptor.ts`, are not changed by `origin/main...HEAD` and are outside this PR review.
- The repository-wide cosmetic-only result, `packages/opencode/src/session/prompt/anthropic.txt`, is also not changed by the PR.
- All 16 PR-intersecting `small-diff` paths retain non-marker differences after marker removal. Examples include `.kilo` agent installation, worker shutdown, legacy instance restoration, Kilo config-directory discovery, snapshot schema typing, and Kilo-specific test setup. The finder threshold means "small enough to review", not "safe to reset".
- `packages/opencode/src/config/paths.ts` and `packages/opencode/src/file/watcher.ts` each contain both stale transform-covered markers and real non-marker Kilo differences. Their individual reset dry-runs correctly say the entire file would be reset, but that is not a recommendation to do so.
- Eleven PR-changed shared marker files do not exist at the corresponding upstream path. They cannot demonstrate an unnecessary marker relative to an upstream-identical implementation, and they were not treated as reset candidates.
- Kilo-owned paths containing `kilocode` or a `kilo-` directory component were excluded from marker requirements and conclusions.

## Exact command outputs

ANSI color bytes are omitted. To keep this repository report ASCII-only, the finder's Unicode heading separator is rendered as `-`; all status text and values are otherwise verbatim.

### Revision and range checks

Command:

```sh
git status --short --branch && git rev-parse HEAD && git rev-parse origin/main && git merge-base origin/main HEAD && git tag --list '*1.15.4*'
```

Output at review start:

```text
## review/upstream-11090-reports
6a1377abaa88902b741f3ffff276aa6b743f3a3c
b90ab85c3b4ad5097fe11e431d0319f31f935d6e
b90ab85c3b4ad5097fe11e431d0319f31f935d6e
v1.15.4
```

Upstream tag resolution:

```text
2b92c5677e830e95d34fc3d5664a69297d2d0b51
2b92c5677e830e95d34fc3d5664a69297d2d0b51
468eb68878974f555ae2a03575d52d716f26e029
release: v1.15.4
```

PR range summary from `git diff --stat origin/main...HEAD`:

```text
270 files changed, 7733 insertions(+), 3901 deletions(-)
```

### Reset CLI help

Command:

```sh
bun run script/upstream/reset-to-upstream.ts --help
```

Output:

```text
Usage: bun run script/upstream/reset-to-upstream.ts <repo-relative-file> [--dry-run]

Resets one file by:
  1. Finding the newest upstream tag whose commit is already merged into HEAD.
  2. Reading that file from upstream at the merged tag.
  3. Applying upstream merge branding transforms.
  4. Writing the transformed upstream file to the working tree.

If the file does not exist upstream, the local file is deleted. Binary files are
written back as raw upstream bytes without text transforms.

Options:
  --dry-run  Show what would change without writing the file.
  --help     Show this help message.
```

### Required finder invocation

Command, run exactly as required:

```sh
bun run script/upstream/find-reset-candidates.ts --dry-run
```

Captured output before the 300-second command timeout:

```text
============================================================
  Find reset-to-upstream candidates
============================================================

[OK] Last merged upstream: v1.15.4 (2b92c567)
[INFO] Scope: (all shared paths)
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 324 non-code asset(s)
[INFO] Skipping 1535 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 785
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 183 (missing or too-large)
[INFO] Classifying 602 file(s)...
[INFO] Classified 50/602
[INFO] Classified 100/602
[INFO] Classified 150/602
[INFO] Classified 200/602
[INFO] Classified 250/602
[INFO] Classified 300/602
[INFO] Classified 350/602
[INFO] Classified 400/602
[INFO] Classified 450/602
[INFO] Classified 500/602
[INFO] Classified 550/602
[INFO] Classified 600/602
[INFO] Classified 602/602

shell tool terminated command after exceeding timeout 300000 ms
```

A serial retry completed:

```sh
bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 1
```

Exact summary and marker-only section:

```text
# Reset-to-upstream candidate report

- Last merged upstream: **v1.15.4** (`2b92c567`)
- Scope: `(all shared paths)`
- Review limit: 5 non-marker diff line(s)
- Mode: dry-run (no writes)
- Total candidates: 785
- Non-code assets skipped: 324
- Config-protected files skipped: 1535

## Summary

| Bucket | Count | Action |
|---|---|---|
| markers-only | 4 | would reset |
| cosmetic-only | 1 | would reset |
| small-diff | 168 | would reset |
| large-diff | 300 | skipped |
| identical | 128 | nothing to do |
| too-large | 1 | skipped |
| upstream-missing | 182 | skipped |
| local-missing | 1 | skipped |
| non-code-asset | 324 | skipped |
| config-protected | 1535 | skipped |

## markers-only (4) - would reset

- `packages/opencode/src/cli/cmd/run/permission.shared.ts`
- `packages/opencode/src/cli/cmd/tui/component/error-component.tsx`
- `packages/opencode/src/mcp/oauth-provider.ts`
- `packages/sdk/js/src/error-interceptor.ts`
```

The full serial output also listed all unrelated repository-wide buckets. Those lists are not repeated here because conclusions are restricted to PR-changed files.

### PR-intersection classification

Exact output from the same classifier over the 89 PR-changed shared marker files:

```text
Shared PR marker files classified: 89
large-diff: 61
markers-only: 1
small-diff: 16
upstream-missing: 11
```

The 17 PR-intersecting finder candidates were:

```text
packages/opencode/src/cli/cmd/agent.ts                    small-diff  5
packages/opencode/src/cli/cmd/tui/worker.ts               small-diff  3
packages/opencode/src/cli/effect-cmd.ts                    small-diff  5
packages/opencode/src/cli/upgrade.ts                       small-diff  2
packages/opencode/src/config/paths.ts                      small-diff  4
packages/opencode/src/effect/instance-state.ts             small-diff  4
packages/opencode/src/file/watcher.ts                      small-diff  2
packages/opencode/src/mcp/oauth-provider.ts                markers-only
packages/opencode/src/session/session.sql.ts               small-diff  2
packages/opencode/test/cli/cmd/tui/sync.test.tsx           small-diff  5
packages/opencode/test/file/watcher.test.ts                small-diff  4
packages/opencode/test/server/httpapi-config.test.ts       small-diff  2
packages/opencode/test/server/httpapi-file.test.ts         small-diff  4
packages/opencode/test/server/httpapi-raw-route-auth.test.ts small-diff 4
packages/opencode/test/session/snapshot-tool-race.test.ts  small-diff  1
packages/opencode/test/tool/external-directory.test.ts     small-diff  2
packages/opencode/test/tool/read.test.ts                   small-diff  4
```

### Per-candidate reset verification

Each path above was passed to:

```sh
bun run script/upstream/reset-to-upstream.ts <path> --dry-run
```

Every invocation emitted:

```text
[OK] Last merged upstream: v1.15.4 (2b92c567)
```

The exact path-specific final lines were:

```text
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/cmd/agent.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/cmd/tui/worker.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/effect-cmd.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/upgrade.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/config/paths.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/effect/instance-state.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/file/watcher.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/mcp/oauth-provider.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/session/session.sql.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/cli/cmd/tui/sync.test.tsx to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/file/watcher.test.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/server/httpapi-config.test.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/server/httpapi-file.test.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/server/httpapi-raw-route-auth.test.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/session/snapshot-tool-race.test.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/tool/external-directory.test.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/tool/read.test.ts to transformed upstream v1.15.4
```

The additional region-level and human-verification paths were also checked with the same reset dry-run syntax. Their exact final lines were:

```text
[INFO] [DRY-RUN] Would reset packages/opencode/script/build.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/acp/agent.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/cmd/github.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/cmd/run.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/config/managed.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/session/prompt.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/session/session.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/provider/provider.test.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/session/compaction.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/skill/index.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/cli/cmd/tui/sync-undefined-messages.test.tsx to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/test/question/question.test.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/effect/bridge.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/snapshot/index.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/opencode/src/tool/shell.ts to transformed upstream v1.15.4
[INFO] [DRY-RUN] Would reset packages/ui/src/components/markdown.tsx to transformed upstream v1.15.4
```

For the whole-file candidate, marker normalization produced:

```sh
bun run script/upstream/fix-kilocode-markers.ts packages/opencode/src/mcp/oauth-provider.ts --dry-run
```

```text
[OK] Last merged upstream: v1.15.4 (2b92c567)
[INFO] [DRY-RUN] Would update packages/opencode/src/mcp/oauth-provider.ts
```

## Limitations

- The required default-concurrency finder invocation did not terminate after reporting all 602 classifications. The completed serial run used identical classification logic and changed only worker concurrency.
- `reset-to-upstream.ts --dry-run` is path-level. For files containing both stale markers and valid Kilo differences, its "Would reset" output confirms a difference but does not mean a wholesale reset is safe.
- Conclusions use the repository's transformed-upstream baseline because both required scripts apply package, branding, i18n, extension, script, and web transforms before comparison. Raw pristine upstream still contains OpenCode branding in several reported regions; after the mandated transforms, the non-marker content is identical.
- Region matching uses the repository marker parser and zero-context git diff. Marker comments on unchanged delimiters can be ambiguous, so those cases are explicitly left for human verification.
- The initial worktree was clean. During the review, unrelated untracked `KILOCODE_CHANGE_MARKERS.md` and `TESTS.md` files appeared from another process. They were not created or modified by this review. This review only created `UNNECESSARY_MARKERS.md`.
