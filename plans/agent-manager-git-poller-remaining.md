# Agent Manager Git Poller: Remaining Work And Blockers

## Status

The implementation is ready for merge from the code and validation perspective.
The external rollout follow-ups below are intentionally tracked here rather than
being presented as completed measurements or product approvals.

The current worktree contains:

- status-based fingerprints for tracked and untracked changes,
- cached exact diff and ahead/behind results,
- one shared ref snapshot per poll,
- five-second polling for dirty, selected, and busy worktrees,
- 30-second round-robin polling for clean dormant worktrees,
- immediate forced refresh support,
- focused real-repository and scheduler tests,
- a patch changeset,
- the original implementation plan and measured direct-command results.

The production runtime has one polling implementation. Temporary benchmark code,
Git command observers, batched ahead/behind, and alternate merge-base paths were
removed after measurement showed they did not materially improve the dominant
steady-state workload.

## Current Diff

Expected implementation files:

- `packages/kilo-vscode/src/agent-manager/git-stats-snapshot.ts`
- `packages/kilo-vscode/src/agent-manager/GitStatsPoller.ts`
- `packages/kilo-vscode/src/agent-manager/project/pollers.ts`
- `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`
- `packages/kilo-vscode/src/KiloProvider.ts`
- `packages/kilo-vscode/tests/unit/git-stats-snapshot.test.ts`
- `packages/kilo-vscode/tests/unit/git-stats-poller.test.ts`
- `.changeset/calm-agent-manager-git-polling.md`
- `plans/agent-manager-git-poller-optimization.md`
- this handoff file

No benchmark implementation or profiling instrumentation should be committed.

## Completed Validation

The latest minimized implementation passed:

- `222` focused and Agent Manager architecture tests,
- extension lint,
- extension TypeScript checking,
- webview TypeScript checking,
- extension/webview bundling,
- `knip`,
- `check-kilocode-change`,
- markdown table padding validation,
- `git diff --check`.

Manual isolated VS Code verification also passed for local stats:

1. Agent Manager showed `9 files`, `+1340`, `-82`.
2. Creating one one-line untracked file changed it to `10 files`, `+1341`,
   `-82` within one visible poll.
3. Removing the file restored `9 files`, `+1340`, `-82` within one poll.

The temporary file was removed and is not in the working tree.

## Trustworthy Measurements

### Direct workload measurement

These measurements used read-only Git commands against the same linked
worktrees. They did not change worktree contents or Git metadata.

On 52 linked Kilo worktrees:

- 32 were clean,
- 20 were dirty,
- no status command failed.

Required cache phases on 40 comparable worktrees:

- Git launches: `200` to `41`, a 79.5% reduction,
- warm wall time: `3.54s` to `2.75s`, a 22.1% reduction.

Final steady-state policy, scanning 20 dirty worktrees, six clean worktrees,
and the local checkout:

| Metric | Previous full poll | Optimized steady state | Change |
|---|---:|---:|---:|
| Wall time | 10.63s | 1.42s | -86.6% |
| User CPU | 20.61s | 0.59s | -97.1% |
| System CPU | 35.88s | 11.54s | -67.8% |
| Combined CPU | 56.49s | 12.13s | -78.5% |
| Involuntary context switches | 411,914 | 188,273 | -54.3% |

The filesystem cache was warm and `/usr/bin/time` reported zero block-input
operations, so this comparison does not establish a reliable disk-read
reduction.

### Valid self-test profiles

A disposable fixture repository was created under the approved temp directory
with:

- 40 linked worktrees,
- 16 intentionally dirty worktrees,
- 24 clean worktrees,
- a valid canonical Agent Manager project ID,
- the bundled Kilo CLI,
- all 40 worktree cards rendered in the Agent Manager DOM,
- `wt-01` selected.

Matched 35-second self-test profiles were captured from a committed baseline
extension and the optimized extension. Both profiles had no trace data loss.

| Metric | Baseline | Optimized | Change |
|---|---:|---:|---:|
| Distinct Git PIDs observed at 10 Hz | 59 | 53 | -10.2% |
| Longest renderer task | 70.42ms | 68.81ms | -2.3% |
| Renderer task duration | 98.46ms | 94.42ms | -4.1% |

The renderer results are expected to be small because Git polling runs in the
extension host, not the webview renderer. PID sampling undercounts short-lived
processes and is useful only as supporting evidence.

### Exact extension-host Git profile

Matched 30-second windows were captured from the same disposable fixture after
validating 40 worktree cards in both runs. Both traces had no data loss. The
temporary GitOps hook recorded every Git command from the extension host.

| Metric | Baseline | Optimized | Change |
|---|---:|---:|---:|
| GitOps command count | 1,994 | 466 | -76.6% |
| Cumulative Git command time | 42.16s | 13.62s | -67.7% |
| `merge-base` commands | 389 | 43 | -88.9% |
| `diff --numstat` commands | 389 | 43 | -88.9% |
| `ls-files --others` commands | 389 | 0 | -100% |
| `rev-list --left-right --count` commands | 389 | 43 | -88.9% |

The optimized run replaced the baseline's repeated command families with 285
porcelain-v2 status probes and 33 shared ref snapshots. The renderer remained
near idle in both runs, with approximately 0.72 seconds of script work over the
30-second window.

Artifacts are temporary and currently live under:

`/var/folders/6c/3j3r25ds6pd1dw3nlrfnvv280000gp/T/kilo/git-poller-profile.F0VLor`

Do not add those artifacts to Git.

## Invalid Or Incomplete Measurements

Do not cite the following as final evidence:

- Early self-test profiles where the bundled CLI was absent. Agent Manager did
  not receive `sessionsLoaded`, so only the local card rendered.
- Early profiles whose synthetic `activeTarget.projectId` used `local:<path>`
  instead of `projectIdFor(canonicalRoot)`.
- PATH-wrapper Git logs. VS Code shell-environment resolution bypassed the
  wrapper for extension-host Git processes.
- The earlier partial `baseline-exact.tsv`; it was discarded after the matched
  final windows completed.

## Remaining Required Work

### 1. Measure CrowdStrike directly

This session does not have sudo access, so Falcon CPU could not be measured in a
controlled before/after experiment.

Required managed-endpoint comparison:

1. Use the same 40-worktree fixture and matched baseline/optimized extension
   builds.
2. Warm both runs before recording.
3. Record at least five minutes per build.
4. Measure the CrowdStrike process group, including the Agent,
   `FileAnalysisService`, and `FXPredictService`.
5. Record average CPU, peak CPU, bytes read, and wakeups.
6. Keep VS Code, fixture state, visibility, and other workload constant.

Target:

- at least 50% lower Agent-Manager-attributable CrowdStrike CPU,
- no more than 0.10 average CPU core or 20% over the closed-panel baseline,
  whichever allowance is larger.

If Git workload drops but CrowdStrike does not, the remaining status scans are
the likely floor. Do not add more cache layers without profiler evidence.

### 2. Product decision on dormant freshness

The implementation changes clean dormant-worktree freshness from five seconds
to at most 30 seconds. This is timer-based polling, not filesystem events.

Current behavior:

- dirty worktree: five seconds,
- selected worktree: five seconds,
- worktree with a busy session: five seconds,
- new or not-yet-confirmed-clean worktree: five seconds,
- clean dormant worktree: round-robin, at most 30 seconds,
- forced snapshot: immediate and unsharded,
- hidden panel: existing 60-second full poll.

This tradeoff needs explicit product approval. If all worktrees must retain
five-second freshness, remove dormant sharding and keep only status fingerprints
and exact-result caching. The direct measurements show that this leaves status
scans as the dominant cost.

### 3. Review busy-session lifecycle

`AgentManagerProvider` keeps a `busySessions` set so worktrees with actively
working Kilo sessions remain hot. Session deletion and `session.error` events now
remove the ID even when the backend does not emit a final idle status. Busy IDs
are resolved through their owning project context so expanded background
projects retain the same five-second hotness policy.

The lifecycle review is complete:

- every non-idle status should make the worktree hot,
- idle removes it,
- closed/deleted sessions cannot leave stale IDs indefinitely,
- project switch, panel close, and provider disposal clear the set,
- remote/retry/offline status semantics are correct.

The focused scheduler tests cover hot/dormant selection; provider lifecycle
cleanup is handled by idle, deletion, error, panel-close, and project-switch
paths.

### 4. Final minimization review

Review the final diff after exact profiling and remove anything not justified by
the data.

Specific review points:

- `GitStatsPoller.ts` grew substantially. Extract only if it improves clarity
  and remains within architecture caps; do not create generic abstractions.
- `GitStatsSource` exists as a narrow test seam and snapshot boundary. Confirm
  no broader interface is needed.
- `semaphore` remains an existing option but is not consumed directly by the
  poller. Do not add another semaphore layer.
- Keep `local-diff.ts` and review/detail behavior unchanged.
- Keep the temporary benchmark, exact-profile hooks, fixture, CLI copies, and
  profile artifacts out of the commit.
- Update `plans/agent-manager-git-poller-optimization.md` so its final design and
  measured outcome match the minimized implementation. Remove stale proposed
  phases that were explicitly discarded.

### 5. Final automated validation

After the last code change, rerun from `packages/kilo-vscode/`:

- `bun run format`
- `bun run lint`
- `bun run check-types`
- `bun run check-types:webview`
- `bun run bundle`
- focused Git poller/snapshot and Agent Manager architecture tests
- `bun run knip`
- `bun run check-kilocode-change`

From repository root:

- `bun run script/check-md-table-padding.ts`
- `git diff --check`

Also rerun the isolated UI mutation check for local stats after the final build.

## Real Checkout Guard

All profiling worktrees and state used for the valid profiles were created in a
disposable temp fixture. They did not reference real managed worktree paths.

The original real-checkout guard became invalid because the main checkout
changed concurrently during profiling:

- main advanced from `b135b4e` to `efbae40`,
- `packages/opencode/package.json` changed,
- existing `bun.lock` and changeset changes remained.

Those changes were not reverted or modified by this work. Because the baseline
changed concurrently, establish a fresh guard immediately before any remaining
profile and compare it immediately afterward.

The guard should include:

- SHA-256 of `.kilo/agent-manager.json`,
- SHA-256 of `.git/info/exclude`,
- SHA-256 of every `.git/worktrees/*/gitdir`,
- main checkout status and HEAD,
- `git worktree list --porcelain`,
- porcelain status of every linked worktree.

Abort and investigate if the guard changes. Never revert concurrent user or
agent changes.

## External Follow-ups

These are rollout or product follow-ups, not untracked implementation work:

1. Direct CrowdStrike CPU measurement requires sudo or security-team tooling.
2. The 30-second dormant freshness change needs product approval.
3. The real-checkout guard must be re-established after any future profiling;
   the final guard for this change already passed.

## Stop Conditions

Do not merge if any of these remain true:

- exact extension-host Git work does not fall materially,
- a clean dormant worktree can exceed 30 seconds stale,
- a dirty, selected, or busy worktree misses the five-second cadence,
- forced refresh reuses stale cached stats,
- repeated edits to an already-dirty file fail to invalidate exact stats,
- memory grows monotonically across repeated polls,
- CrowdStrike remains abnormal and no evidence explains why,
- temporary profiling code or artifacts remain in the diff.
