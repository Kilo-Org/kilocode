# Agent Manager Diff — Full Refactor Plan

This document describes the complete refactor needed to bring the Agent Manager diff pipeline
to a performant, scalable architecture. It is informed by profiling data (see `DIFF_PERF_ANALYSIS.md`)
and by how OpenCode Desktop solves the same problems.

Work is split into two phases. Phase 1 (quick surgical fixes) ships first, we re-measure,
then Phase 2 fills the remaining architectural gaps.

---

## Phase 1 — Quick Surgical Fixes

Goal: eliminate ~70% of the measured overhead with minimal code change.

### 1.1 Parallelize server-side file reads

**File:** `packages/opencode/src/server/routes/experimental.ts`

**Problem:** The `for` loop at line ~268 reads 72 files sequentially via `git show` subprocesses +
`Bun.file().text()`. This takes ~950ms — 90% of the total request time.

**Fix:** Replace the sequential loop with `Promise.all` and a concurrency limiter (cap at ~10
to avoid spawning 150 git processes at once).

```ts
// Before (sequential, ~950ms for 72 files):
for (const entry of entries) {
  const before = await $`git show ${ancestor}:${file}`...
  const after = await Bun.file(...).text()
}

// After (parallel, expected ~100-150ms for 72 files):
const CONCURRENCY = 10
const results = await pMap(entries, async (entry) => {
  const [before, after] = await Promise.all([gitShow(...), readFile(...)])
  return { file, before, after, ...stats }
}, { concurrency: CONCURRENCY })
```

We don't need an external dep for this — a simple chunked `Promise.all` or a tiny helper is enough.

**Expected impact:** Request time drops from ~1,050ms to ~200-300ms per worktree.

### 1.2 Stats-only endpoint for GitStatsPoller

**Files:**

- `packages/opencode/src/server/routes/experimental.ts` (new endpoint)
- `packages/sdk/js/` (regenerate after adding endpoint)
- `packages/kilo-vscode/src/agent-manager/GitStatsPoller.ts` (switch to new endpoint)

**Problem:** GitStatsPoller calls `client.worktree.diff()` for every worktree just to read
3 numbers (files, additions, deletions). Each call downloads 4.93MB of file contents.
This accounts for ~56% of all server requests.

**Fix:** Add `GET /experimental/worktree/stats` that runs only:

```
git merge-base HEAD <base>
git diff --numstat --no-renames <ancestor>
git ls-files --others --exclude-standard | wc -l
```

Returns `{ files: number, additions: number, deletions: number }` — no file content.

GitStatsPoller switches from `client.worktree.diff()` to `client.worktree.stats()`.

**Expected impact:** Stats polling drops from ~1,100ms + 4.93MB to ~50ms + <1KB per worktree.
Total server load drops by ~50-60%.

### 1.3 Busy guard on pollDiff

**File:** `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`

**Problem:** `setInterval(pollDiff, 2500)` fires regardless of whether the previous poll
has completed. When a request takes >2.5s (common under contention), polls stack up and
the same worktree gets multiple concurrent requests.

**Fix:** Add a `polling` boolean guard:

```ts
private polling = false

private async pollDiff(sessionId: string): Promise<void> {
  if (this.polling) return
  this.polling = true
  try {
    // ... existing logic ...
  } finally {
    this.polling = false
  }
}
```

**Expected impact:** Eliminates overlapping polls. Worst case, a poll runs every `max(2.5s, requestDuration)`.

### 1.4 Fix hashFileDiffs

**File:** `packages/kilo-vscode/src/review-utils.ts`

**Problem:** The hash includes full `diff.after` content for every file:

```ts
diffs.map((d) => `${d.file}:${d.status}:${d.additions}:${d.deletions}:${d.after}`).join("|")
```

For 72 files this creates a ~2.5MB string every 2.5 seconds just for change detection.

**Fix:** Remove `diff.after` from the hash. The `additions`/`deletions` counts from
`git diff --numstat` already change when file content changes, so this is sufficient:

```ts
export function hashFileDiffs(diffs: FileDiff[]): string {
  return diffs.map((d) => `${d.file}:${d.status}:${d.additions}:${d.deletions}`).join("|")
}
```

**Expected impact:** Hash computation drops from potentially multi-ms (large string alloc)
to sub-ms. More importantly, eliminates a multi-MB string allocation every 2.5 seconds.

---

## Phase 2 — Architectural Improvements

Goal: close the remaining performance gap with the Desktop. Address the structural issues
that Phase 1 doesn't fix.

### 2.1 Shared diff cache between pollDiff and GitStatsPoller

**Files:**

- `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`
- `packages/kilo-vscode/src/agent-manager/GitStatsPoller.ts`

**Problem:** Both `pollDiff` and `GitStatsPoller` independently fetch diffs for overlapping
worktrees. They never share data. The same worktree (`kilo-...361480`) was requested 11 times
in 90 seconds by different callers.

**Design:** Introduce a `DiffCache` that both callers read/write:

```ts
interface CachedDiff {
  diffs: FileDiff[]
  hash: string
  fetchedAt: number // timestamp
}

class DiffCache {
  private cache = new Map<string, CachedDiff>()

  // Get cached diffs if fresh enough (within maxAge ms)
  get(directory: string, maxAge: number): CachedDiff | undefined

  // Store a fresh result
  set(directory: string, diffs: FileDiff[], hash: string): void

  // Derive stats from cached data without fetching
  stats(directory: string): { files: number; additions: number; deletions: number } | undefined
}
```

`pollDiff` populates the cache when it fetches. `GitStatsPoller` reads from the cache
if the entry is fresh enough (e.g. <10s old); only fetches if stale. If Phase 1's
stats-only endpoint exists, the poller uses that instead of full diff.

**Expected impact:** Eliminates nearly all redundant requests. With 2 worktrees,
server requests drop from ~8/cycle to ~2-3/cycle.

### 2.2 Serialize GitStatsPoller worktree requests

**File:** `packages/kilo-vscode/src/agent-manager/GitStatsPoller.ts`

**Problem:** `fetchWorktreeStats` uses `Promise.all` across all worktrees, creating
the thundering herd that causes git lock contention (22ms → 472ms per git command).

**Fix:** Fetch worktrees sequentially (or with concurrency 1):

```ts
// Before:
const stats = await Promise.all(active.map(async (wt) => { ... }))

// After:
const stats: WorktreeStats[] = []
for (const wt of active) {
  const result = await fetchSingle(wt)
  if (result) stats.push(result)
}
```

Combined with 2.1 (shared cache) and 1.2 (stats endpoint), this becomes very cheap.

**Expected impact:** Eliminates git lock contention. Each git command stays at ~20ms
instead of inflating to ~470ms.

### 2.3 Lazy-load file contents

**Files:**

- `packages/opencode/src/server/routes/experimental.ts` (new endpoint)
- `packages/sdk/js/` (regenerate)
- `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`
- `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx`
- `packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx`
- `packages/kilo-vscode/webview-ui/agent-manager/FullScreenDiffView.tsx`

**Problem:** The server returns all file contents in a single response. For 72 files
that's 4.93MB transferred via HTTP, then via `postMessage` to the webview, even though
the user only sees 5-10 expanded files at a time.

**Design — two-phase protocol:**

**Phase A: Metadata fetch** — new `GET /experimental/worktree/diff-summary` returns:

```json
[
  { "file": "src/foo.ts", "status": "modified", "additions": 42, "deletions": 10 },
  { "file": "src/bar.ts", "status": "added", "additions": 100, "deletions": 0 }
]
```

No `before`/`after` content. Fast (~50-100ms). Used for the file list, stats, accordion headers.

**Phase B: Content fetch on demand** — existing `GET /experimental/worktree/diff` with a
new `?files=src/foo.ts,src/bar.ts` query param to fetch content for specific files.
Called when the user expands an accordion item. Could also batch the initially-visible files.

The webview stores `WorktreeFileDiff` entries where `before`/`after` start as `undefined`
and are populated lazily. The `<Diff>` component only renders once content arrives.

**Expected impact:** Initial load drops from 4.93MB / 1s to ~10KB / 100ms. Content loads
incrementally as needed. Session switching becomes near-instant.

### 2.4 Adaptive poll interval

**File:** `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`

**Problem:** Fixed 2.5s poll interval doesn't account for request duration or panel visibility.

**Fix:**

- Base interval: 5s (up from 2.5s)
- After a no-change poll: increase to 10s (nothing is changing, slow down)
- After a change is detected: reset to 5s
- When panel is not visible: pause polling entirely
- Never fire faster than `max(interval, lastRequestDuration * 1.5)`

```ts
private nextPollDelay(): number {
  const base = this.lastDiffChanged ? 5000 : 10000
  const minDelay = Math.max(base, (this.lastPollDuration ?? 0) * 1.5)
  return minDelay
}
```

**Expected impact:** Reduces steady-state polling from 24 req/min to ~6-12 req/min.
Eliminates polling when user isn't looking at the diff panel.

### 2.5 Large-diff rendering gate (match Desktop)

**Files:**

- `packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx`
- `packages/kilo-vscode/webview-ui/agent-manager/FullScreenDiffView.tsx`
- `packages/kilo-vscode/webview-ui/agent-manager/diff-open-policy.ts`

**Problem:** The Agent Manager collapses large files in the accordion but still renders
the `<Diff>` component when the user opens it. The Desktop blocks rendering entirely
with a "Render anyway" button for >500 changed lines.

**Fix:** Add the same gate. When a file has `additions + deletions > 500`, show a
placeholder with file stats and a "Render diff" button instead of the `<Diff>` component.

```tsx
const tooLarge = () => !force() && diff.additions + diff.deletions > 500

<Show when={!tooLarge()} fallback={
  <div class="am-diff-too-large">
    <span>Large file: +{diff.additions} / -{diff.deletions} lines</span>
    <Button onClick={() => setForce(true)}>Render diff</Button>
  </div>
}>
  <Diff before={...} after={...} />
</Show>
```

**Expected impact:** Prevents the pierre worker pool from being saturated by large files
the user hasn't explicitly asked to see.

### 2.6 Webview equality check optimization

**File:** `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx`

**Problem:** On every poll message, the webview compares full `before` + `after` strings
for all 72 files on the UI thread. This is O(n × content_size).

**Fix (depends on 1.4):** Since the extension already computes a hash for dedup and only
sends data when the hash changes, the webview doesn't need its own deep equality check.
Include the hash in the message:

```ts
// Extension sends:
this.postToWebview({ type: "agentManager.worktreeDiff", sessionId, diffs, hash })

// Webview skips comparison if hash matches:
if (ev.hash === lastReceivedHash) return prev
lastReceivedHash = ev.hash
return { ...prev, [ev.sessionId]: ev.diffs }
```

If the extension only sends on hash change (which the busy guard + fixed hash ensures),
this check becomes trivially cheap.

**Expected impact:** Eliminates multi-MB string comparison on the UI thread every 2.5s.

---

## Phase Summary

### Phase 1 (ship first)

| #   | Change                 | File(s)                                     | Estimated impact                  |
| --- | ---------------------- | ------------------------------------------- | --------------------------------- |
| 1.1 | Parallelize file reads | `experimental.ts`                           | Request time: 1,050ms → 200-300ms |
| 1.2 | Stats-only endpoint    | `experimental.ts`, `GitStatsPoller.ts`, SDK | Server load: -50-60%              |
| 1.3 | Busy guard on pollDiff | `AgentManagerProvider.ts`                   | Eliminates overlapping polls      |
| 1.4 | Fix hashFileDiffs      | `review-utils.ts`                           | Eliminates multi-MB string alloc  |

### Phase 2 (after re-measuring)

| #   | Change                        | File(s)                                        | Estimated impact                       |
| --- | ----------------------------- | ---------------------------------------------- | -------------------------------------- |
| 2.1 | Shared diff cache             | `AgentManagerProvider.ts`, `GitStatsPoller.ts` | Eliminates redundant requests          |
| 2.2 | Serialize GitStatsPoller      | `GitStatsPoller.ts`                            | Eliminates git lock contention         |
| 2.3 | Lazy-load file contents       | Server, SDK, Extension, Webview                | Initial load: 4.93MB → ~10KB           |
| 2.4 | Adaptive poll interval        | `AgentManagerProvider.ts`                      | Polling: 24 req/min → 6-12             |
| 2.5 | Large-diff rendering gate     | `DiffPanel.tsx`, `FullScreenDiffView.tsx`      | Prevents worker pool saturation        |
| 2.6 | Webview equality optimization | `AgentManagerApp.tsx`                          | Eliminates UI-thread string comparison |

### Expected Combined Result

| Metric                    | Current      | After Phase 1 | After Phase 2          |
| ------------------------- | ------------ | ------------- | ---------------------- |
| Request time (72 files)   | ~1,050ms     | ~200-300ms    | ~100ms (metadata only) |
| Requests per minute       | ~16          | ~8-10         | ~4-6                   |
| Data per poll cycle       | ~15-25 MB    | ~5-10 MB      | ~10-50 KB (metadata)   |
| Session-switch latency    | 3-5s (hang)  | ~500ms        | ~100ms                 |
| Git subprocess contention | 21× slowdown | 2-3×          | ~1× (serialized)       |
