# Plan: Optimize Agent Manager Git Stats Polling

## Problem

Agent Manager periodically computes exact diff and ahead/behind statistics for
the local checkout and every visible managed worktree. The timer itself is not
the problem. The expensive part is that every poll reconstructs the same state
through several independent Git processes and filesystem passes, even when a
worktree has not changed.

For each worktree, the current hot path does the following:

1. `git merge-base HEAD <base>`
2. `git diff --name-status --no-renames <merge-base>`
3. `git diff --numstat --no-renames <merge-base>`
4. `git ls-files --others --exclude-standard`
5. `git rev-list --left-right --count <base>...HEAD`
6. `lstat`, binary detection, and line counting for every untracked file

The poll also runs `git worktree list --porcelain` once for presence and branch
information. `GitStatsPoller` suppresses an unchanged webview message only after
all of the work above has finished, so the existing result hash does not reduce
Git CPU, process creation, or disk reads.

The cost scales linearly with the number of worktrees and expanded projects.
The shared semaphore limits concurrent child processes, but it does not reduce
the total work. On endpoint-protected machines, every extra Git process and file
scan also creates security-agent work.

## Constraints

- Keep timer-based polling. Do not introduce filesystem watchers, FSEvents, or
  another event-driven invalidation system.
- Preserve the current visible interval, hidden interval, skip behavior,
  non-overlap guarantees, and manual `snapshot(true)` refresh behavior through
  the command-consolidation and cache phases. Permit bounded timer-based
  sharding only if measurement proves the mandatory status scans remain above
  the CPU/disk or endpoint-security goals.
- Preserve exact UI semantics for tracked, staged, unstaged, deleted, binary,
  image, and untracked files, including exact addition/deletion totals.
- Preserve ahead/behind semantics against each worktree's configured
  `remoteRef(wt)`. Do not fetch from remotes.
- Do not modify user or repository Git configuration. In particular, do not
  enable `core.fsmonitor`, untracked cache, split index, or maintenance as a
  side effect of opening Agent Manager.
- Keep all child processes behind the existing shared `Semaphore` and abort
  controller.
- Keep the implementation in the VS Code extension. Do not move polling back
  to `kilo serve` because the local path intentionally avoids Bun child-process
  memory growth on Windows.
- Do not include the separate Git executable resolution / macOS double-exec
  work. That can land independently.

## Goal

Make each periodic poll proportional to the amount of changed state rather than
repeating every exact diff calculation for every worktree.

For an unchanged worktree, the steady-state poll should perform one read-only
Git status probe and no base-relative diff or history walk. When a worktree does
change, it should compute the exact UI statistics with fewer Git processes and
fewer repeated index/worktree traversals than today.

## Recommended Design

Use a two-level timer-driven poll:

1. One canonical status scan returns enough state to decide whether the
   previous exact result is reusable.
2. Only a changed probe triggers exact diff and ahead/behind calculation.

The cache is an optimization, not a source of truth. The first poll, a forced
snapshot, a failed probe, a changed base, or an uncertain fingerprint always
falls back to exact calculation.

### Feasibility and lower bound

The status, merge-base numstat, ref snapshot, and `rev-list` commands used here
are available in current Git and have stable machine-readable output. Every
optimization also has a failure fallback.

This design does not make polling free. Without filesystem watchers or Git
fsmonitor, there is no repository-level hash that reveals arbitrary unstaged or
untracked file changes. Exact periodic detection must scan each worktree. Git
cannot status several independent worktree/index pairs in one invocation, so
one status process and one working-tree scan per active worktree per interval is
the practical lower bound under these constraints.

The expected gain comes from removing duplicate scans, exact line-count diffs,
and history walks after that mandatory status scan. Process-count savings will
therefore be larger than CPU and disk savings. CrowdStrike CPU normalization is
a measured acceptance gate, not an assumed consequence of reducing process
launches.

### Level 1: Worktree fingerprint

Add a polling-specific helper that runs:

```text
git --no-optional-locks status \
  --porcelain=v2 --branch -z \
  --no-ahead-behind --untracked-files=all --no-renames
```

Parse its stable machine format into:

- current `HEAD` OID and branch,
- tracked and untracked paths,
- staged/unstaged status and index object IDs,
- a deterministic status payload.

The status payload alone is not a safe cache key. Editing a file that is
already reported as modified can leave the porcelain text unchanged. Complete
the fingerprint in Node with bigint `lstat` metadata for every changed
non-deleted path: size, nanosecond mtime/ctime when supported, inode, mode, and
file type. Include these values in a deterministic hash together with:

- worktree path,
- configured base ref,
- `HEAD` OID,
- status records and paths,
- the cached base-ref OID from the project-level ref snapshot described below.

This does not hash file contents. It detects normal editor writes, atomic
renames, staging, commits, branch switches, untracked-file changes, and local
tracking-ref changes while avoiding a full exact diff on an unchanged tree.

If any path cannot be statted, contains unsupported status data, or changes
during probing, mark the fingerprint uncertain and run the exact path. Never
reuse cached stats on uncertainty.

The fingerprint cache is in memory and scoped to one `GitStatsPoller`. Store per
worktree:

```ts
type CachedStats = {
  base: string
  fingerprint: string
  stats: WorktreeStats
}
```

Do not retain every `WorktreeDiffEntry` in the poller cache. Large worktrees can
have thousands of changed files, while the poller only needs aggregate stats.
Keep review and file-detail metadata outside this cache. Bound aggregate cache
entries by active worktree IDs and clear them on `stop()` so project switches
and disposal cannot leak stale state.

### Level 2: Exact recomputation with fewer traversals

When a fingerprint changes, reuse the probe's untracked paths instead of
running `git ls-files --others --exclude-standard` again.

Replace the separate merge-base process with Git's built-in merge-base diff
form:

```text
git -c core.quotepath=false diff \
  --merge-base --numstat -z --no-renames <base>
```

The poller only renders aggregate file/addition/deletion counts, so it does not
need tracked-file status records or `WorktreeDiffEntry` objects. Numstat alone
provides the tracked file count, exact text counts, and binary markers currently
obtained from `merge-base`, `diff --name-status`, and `diff --numstat`. `-z`
makes paths safe for tabs, newlines, Unicode, and unusual filenames.

The polling helper should therefore compute a changed worktree with:

- one status/fingerprint process,
- one combined tracked-diff process,
- no second untracked enumeration,
- one history calculation only when the commit/base pair changed.

Do not change `diffFile`'s on-demand detail path in this work. It is not periodic
and has different materialization requirements.

### Batch project ref state

Run one project-level ref snapshot per poll before processing individual
worktrees:

```text
git for-each-ref \
  --format=%(refname)%00%(objectname)%00%(upstream)%00%(symref)%00 \
  refs/heads refs/remotes
```

Use it to map every local branch and remote base ref to an OID, each local
branch to its configured upstream, and each remote `HEAD` to its symbolic
default branch. Combine this with `git worktree list --porcelain -z`, whose
records already contain each worktree's `HEAD` OID and branch. Extend the
existing worktree parser and `listWorktreePaths` result instead of launching
`rev-parse`, `symbolic-ref`, or config queries in each worktree.

For the local checkout, preserve the current tracking-resolution fallback when
the ref snapshot is insufficient (for example, unusual configuration with a
branch remote but no upstream merge ref). Cache that resolution as today. Do
not trade a small process reduction for a change in which base branch is used.

The project snapshot supplies three things:

- the presence and checked-out branch information already used by the poller,
- the `HEAD` OID for each worktree,
- the base-ref OID used in the fingerprint and ahead/behind cache key.

Cache ahead/behind by `<headOID>\0<baseOID>`. If both OIDs are unchanged, reuse
the previous counts even when only working-tree files changed. This removes
history walks from normal editing polls.

The implementation uses the ref snapshot to cache base OIDs and reuses
ahead/behind counts when the worktree `HEAD` and base OID are unchanged. A
changed worktree uses the existing `rev-list --left-right --count <base>...HEAD`
path. Batched ahead/behind and merge-base fast paths were tested but removed
because they did not improve the dominant steady-state workload enough to
justify their compatibility and maintenance cost.

### Forced refresh and failure behavior

- The initial poll always computes exact results.
- `snapshot(true)` bypasses fingerprint reuse and recomputes exact results for
  skipped and unskipped worktrees, matching current behavior.
- A base string or base OID change invalidates diff and ahead/behind caches.
- A branch or `HEAD` OID change invalidates both caches.
- A fingerprint change invalidates exact diff stats but not ahead/behind when
  the commit/base OIDs are unchanged.
- Missing worktrees are removed from all caches when presence is reconciled.
- A transient exact-diff failure preserves last-known stats, matching the
  current poller contract.
- A transient fingerprint/ref-snapshot failure runs exact calculation. If that
  also fails, preserve last-known stats.
- Do not promote an exact result to a reusable cache entry when metadata for its
  known paths changes while the exact calculation is running. Emit the result,
  then let the next timer tick confirm or recompute it; this preserves the
  current eventual correction behavior without adding a second status process
  to every changed poll.
- `syncSkips()` must not discard cached data. Collapsing and re-expanding a
  section should reuse the last exact result after a confirming fingerprint.

## Changes

### 1. Add a polling snapshot module

Create `packages/kilo-vscode/src/agent-manager/git-stats-snapshot.ts` as a
VS Code-free module. Keep parsing, hashing, cache decisions, and aggregation out
of `GitStatsPoller.ts` so the existing file does not grow into another mixed
responsibility controller.

The module should own:

- porcelain-v2 `-z` parsing,
- numstat `-z` parsing,
- metadata fingerprint construction,
- exact aggregate file/addition/deletion calculation, and
- cache-key and invalidation decisions.

Use explicit parse-result errors rather than silently treating malformed output
as a clean worktree.

### 2. Extend `GitOps`

Use the existing `GitOps` buffered execution methods through the narrow
`GitStatsSnapshot` source boundary. Do not expose the generic private `raw()`
method or bypass the existing semaphore. Use `execGitBuffer()` for NUL-delimited
output.

Retain the current untracked-file safeguards in the aggregate implementation:
content reads capped at 1 MB and content-based binary detection. Do not call
`git status` without `--no-ahead-behind`; otherwise every supposedly cheap probe
can perform the history walk this design is trying to cache.

### 3. Update `GitStatsPoller`

Replace the independent `localDiff` + `aheadBehind` calls with a project poll
coordinator:

1. collect presence, worktree `HEAD`s, and ref OIDs once,
2. run status probes for active worktrees through the shared semaphore,
3. reuse cached exact results for matching fingerprints,
4. recompute exact summaries only for changed/uncertain worktrees,
5. merge successful results into `lastStats` and emit only when the aggregate
   UI hash changed.

Replace the injected `localDiff` callback with a narrow exact aggregate callback
or snapshot service. Do not construct full `WorktreeDiffEntry[]` merely to reduce
them to three numbers.

The local checkout should use the same snapshot/cache path instead of separately
resolving branch, tracking branch, diff, and ahead/behind every tick. Preserve
the existing no-base fallback to `workingTreeStats`.

Keep the current trailing-delay scheduler. Do not change polling intervals in
this optimization.

### 4. Keep review/detail diff code separate

Leave `local-diff.ts`, `createLocalDiff`, `diffSummary`, and `diffFile` behavior
unchanged in this optimization. Review and file-detail requests need per-file
status, stamps, merge-base identity, and materialization data that the poller
does not need. Sharing those objects would retain potentially thousands of
entries per worktree and broaden the regression surface for an infrequent path.

## Final Implementation

The measured implementation combines the useful parts of the original proposal:

- one porcelain-v2 status/fingerprint probe for each selected worktree,
- one shared ref snapshot per project poll,
- exact numstat and untracked line counting only after a fingerprint change,
- cached ahead/behind counts keyed by `HEAD` and base OIDs,
- five-second polling for dirty, selected, busy, and newly confirmed worktrees,
- deterministic 30-second round-robin polling for clean dormant worktrees,
- immediate unsharded `snapshot(true)` refreshes, and
- last-known stats preservation when a later Git operation fails.

The clean dormant sharding was added only after direct workload and extension-host
profiles showed that status probes remained the dominant steady-state cost. It is
timer-based polling, not filesystem event invalidation. Product approval is still
required for the bounded 30-second freshness tradeoff.

Batched ahead/behind, merge-base shortcuts, persistent Git workers, and shipped
benchmark or profiling hooks were explicitly discarded after measurement.

## Tests

### Parser and exact-result parity

Add focused tests for the new snapshot module using the real temporary-repository
fixtures and helpers in `tests/unit/local-diff.test.ts`:

- clean worktree,
- committed changes since base,
- staged-only, unstaged-only, and staged-plus-unstaged changes,
- added, modified, deleted, type-changed, and conflicted files,
- untracked text and binary files,
- ignored files excluded,
- filenames containing spaces, tabs, newlines, and non-ASCII characters,
- symlinks and deleted paths,
- stale/missing base refs,
- detached HEAD,
- base ref advancing without a working-tree change.

For every fixture, compare the optimized aggregate output to the sum of the
current `diffSummary` entries and to the current `aheadBehind` result before
switching the poller to the new implementation.

### Cache invalidation

Extend `tests/unit/git-stats-poller.test.ts` with command recording and assert:

- second unchanged poll runs a status probe but no exact diff or `rev-list`,
- editing an already-modified file changes the metadata fingerprint and updates
  line counts,
- staging without changing file contents invalidates the fingerprint,
- commit and branch changes invalidate diff and ahead/behind,
- remote-tracking ref changes invalidate base-dependent values,
- working-tree-only edits reuse ahead/behind,
- `snapshot(true)` bypasses cache reuse,
- skipped worktrees remain cached but are not emitted,
- missing worktrees evict cached state,
- malformed/failed probes fall back to exact computation,
- exact failures retain last-known stats,
- `stop()` clears caches and stale generations cannot publish results.

- hot worktrees are polled on every visible tick,
- clean dormant worktrees rotate without starvation and are sampled within
  30 seconds,
- a dirty result promotes a worktree to hot immediately,
- two consecutive clean polls return it to the dormant queue,
- forced refreshes bypass the shard budget,
- deleted sessions cannot leave stale busy IDs indefinitely, and
- every Git operation remains behind the shared semaphore.

## Performance Verification

Use disposable fixtures and isolated VS Code instances for before/after
measurements. Do not add benchmark scripts, Git hooks, or profiling observers to
the product diff.

The final matched extension-host profile used 40 rendered worktrees for 30
seconds. It recorded 1,994 baseline GitOps commands versus 466 optimized commands
and 42.16 seconds versus 13.62 seconds of cumulative Git command time. The
direct workload profile also showed a 78.5% reduction in combined Git CPU.

Acceptance criteria now are:

- exact aggregate output parity across real temporary-repository fixtures,
- no exact diff or history walk for an unchanged cached worktree,
- dirty, selected, busy, and new worktrees observed on five-second ticks,
- every clean dormant worktree observed within 30 seconds,
- forced refresh bypasses sharding and cache reuse,
- no monotonic memory growth across repeated polls, and
- no repository configuration or index-format changes.

CrowdStrike CPU remains an external managed-endpoint measurement. It must be
recorded directly before claiming an endpoint-security reduction; Git command or
process reductions are not a substitute for that measurement.

## Verification

From `packages/kilo-vscode/`:

- `bun run test:unit -- --grep "GitStatsPoller|diffSummary|GitOps|parseWorktreeList"`
- `bun run typecheck`
- `bun run lint`
- `bun run knip`
- `bun run check-kilocode-change`

Manually verify that Agent Manager stats update within one visible poll after
editing, staging, committing, switching branches, and updating a local tracking
ref. Verify that clean dormant worktrees rotate within 30 seconds and that
forced refreshes bypass the shard budget.

## Risks And Mitigations

- **False cache hits from unchanged status text.** Include per-path metadata and
  fail open to exact computation. Test repeated edits to the same modified path.
- **timestamp granularity or preserved timestamps.** Use bigint stat metadata
  including nanosecond mtime/ctime where supported, size, inode, mode, and
  status/index metadata. Treat this as a performance cache and force exact
  refresh on manual requests. If tests show a supported filesystem can preserve
  all fields across a content edit, add a bounded content sample hash for
  changed files rather than hashing every full file.
- **Races while files are changing.** The status fingerprint is sampled before
  exact calculation. A later status probe corrects any edit that races the
  calculation, and failed exact operations retain the prior known result.
- **User Git configuration changes output or cost.** Use porcelain/numstat
  machine formats, explicit `--no-renames`, `-z`, and `--no-optional-locks`.
- **Older Git versions.** Use the existing `merge-base` and `rev-list` commands;
  do not require an upgrade merely to show stats.
- **Large untracked sets remain expensive.** Enumeration is required for exact
  feature parity. The optimization ensures it happens once per tick and line or
  binary reads happen only when the fingerprint changes.
- **Shared refs change during a poll.** Bind one project ref snapshot to a poll
  generation. A later tick corrects races; failed exact operations retain the
  prior known result.

## Out Of Scope

- Filesystem watchers or event-driven invalidation.
- Changing the five-second visible or 60-second hidden intervals. Clean dormant
  worktrees use the measured 30-second round-robin bound.
- Resolving the macOS `/usr/bin/git` launcher to avoid double execution.
- CrowdStrike or other endpoint-security exclusion policies.
- Enabling Git fsmonitor, untracked cache, split index, sparse checkout, or
  repository maintenance.
- Optimizing infrequent apply, merge, PR, fetch, or file-detail commands.

## Measured Outcome

Implementation retained only the optimizations that reduced the real workload:

- one porcelain-v2 status fingerprint per polled worktree,
- exact diff and ahead/behind reuse while file and ref fingerprints are stable,
- 30-second round-robin polling for clean dormant worktrees,
- five-second polling for dirty, selected, or running worktrees,
- immediate full polling for forced snapshots.

Removed after measurement:

- the temporary legacy/optimized benchmark implementation,
- generic Git command instrumentation,
- batched ahead/behind and merge-base fast paths that affected cold polls but
  not the dominant steady-state workload.

Measurements on the same repository on 2026-08-05:

- 52 linked worktrees: 32 clean, 20 dirty, no status failures.
- Required cache phases, 40 comparable worktrees: Git launches fell from 200 to
  41 (79.5%); warm wall time fell from 3.54 seconds to 2.75 seconds (22.1%).
- Final steady-state policy scanned 20 dirty worktrees plus a six-worktree clean
  shard and the local checkout.
- Prior full-poll workload: 10.63 seconds wall, 20.61 seconds user CPU, 35.88
  seconds system CPU, 411,914 involuntary context switches.
- Final steady-state workload: 1.42 seconds wall, 0.59 seconds user CPU, 11.54
  seconds system CPU, 188,273 involuntary context switches.
- Matched 30-second extension-host windows with 40 rendered worktrees: GitOps
  command count fell from 1,994 to 466 (76.6%), and cumulative Git command time
  fell from 42.16 seconds to 13.62 seconds (67.7%). Both runs had no trace data
  loss.

The final comparison is a local process-level measurement, not a direct
CrowdStrike process measurement because this session has no sudo access. Falcon
CPU must still be checked on the managed endpoint after deployment; no security
policy exception is justified by this implementation result alone.
