# Agent Manager Diff Performance Analysis

## Architecture Overview

The diff pipeline has 3 layers:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: CLI Server                                    │
│  GET /experimental/worktree/diff                        │
│  packages/opencode/src/server/routes/experimental.ts    │
│  ─ git merge-base, git diff, git show per file          │
│  ─ Reads full before/after content for every file       │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP (every 2.5s poll)
┌──────────────────────▼──────────────────────────────────┐
│  Layer 2: Extension Host (Node.js)                      │
│  AgentManagerProvider.ts — pollDiff / startDiffPolling   │
│  GitStatsPoller.ts — fetchWorktreeStats (every 5s)      │
│  ─ hashFileDiffs() over full content for dedup          │
│  ─ postMessage to webview with full FileDiff[]          │
└──────────────────────┬──────────────────────────────────┘
                       │ postMessage (webview boundary)
┌──────────────────────▼──────────────────────────────────┐
│  Layer 3: Webview (SolidJS)                             │
│  AgentManagerApp.tsx — receives diffs, equality check   │
│  DiffPanel.tsx / FullScreenDiffView.tsx — accordion     │
│  packages/ui/src/components/diff.tsx — @pierre/diffs    │
│  ─ Per-file diff computation in Web Worker pool (2)     │
│  ─ Syntax highlighting via Shiki WASM                   │
└─────────────────────────────────────────────────────────┘
```

## Comparison: Agent Manager vs OpenCode Desktop

| Aspect           | Agent Manager                                                           | OpenCode Desktop                                             |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Endpoint         | `GET /experimental/worktree/diff` (live)                                | `GET /session/{sessionID}/diff` (stored snapshot)            |
| Data source      | Live git working tree — runs git commands at request time               | Pre-computed snapshots captured at commit time               |
| Update mechanism | **Polling every 2.5s** + GitStatsPoller every 5s                        | **SSE push** (`session.diff` event) — zero polling           |
| Initial fetch    | Immediate on panel open                                                 | Lazy — only when review panel is opened                      |
| Dedup strategy   | `hashFileDiffs()` — concatenates all `after` content into string        | SolidJS store: `reconcile()` by file key                     |
| Inflight dedup   | None — overlapping polls can race                                       | `runInflight()` prevents duplicate requests                  |
| Large diff guard | >400 changed lines → collapsed accordion (still renders on open)        | >500 changed lines → "Render anyway" gate (blocks rendering) |
| Auto-open policy | Opens all non-large files                                               | >10 files → all collapsed                                    |
| Stats polling    | GitStatsPoller fetches **full** `worktree.diff` per worktree for counts | Derived from already-cached store                            |
| Content transfer | Full before/after every 2.5s via postMessage                            | Once on fetch, then incremental SSE reconcile                |

## Identified Bottlenecks

### 1. Sequential file content reads on server (CRITICAL)

**Location:** `packages/opencode/src/server/routes/experimental.ts:268-304`

Every changed file is read sequentially with `await` inside a loop:

```ts
for (const line of nameStatus...) {
    const before = await $`git show ${ancestor}:${file}`  // subprocess
    const after = await Bun.file(path.join(dir, file)).text()
    diffs.push({ file, before, after, ... })
}
```

With 100 files, this is 100+ sequential subprocess calls + 100 file reads.

### 2. Full file contents transferred every 2.5 seconds (CRITICAL)

**Location:** `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts:1753-1773`
**Location:** `packages/kilo-vscode/src/review-utils.ts:45-47`

The `hashFileDiffs` includes full `diff.after` content in the hash string:

```ts
export function hashFileDiffs(diffs: FileDiff[]): string {
  return diffs.map((diff) => `${diff.file}:${diff.status}:${diff.additions}:${diff.deletions}:${diff.after}`).join("|")
}
```

Every 2.5s: server reads all files → extension builds multi-MB hash string → transfers full payload via postMessage.

### 3. GitStatsPoller fetches full diffs for stats only (HIGH)

**Location:** `packages/kilo-vscode/src/agent-manager/GitStatsPoller.ts:146-174`

Fetches `client.worktree.diff()` for **every worktree** on 5s interval just to count files/additions/deletions. Downloads full before/after file contents when only numstat is needed.

### 4. All expanded Diff components compute simultaneously (HIGH)

**Location:** `packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx:430-440`

When auto-open policy expands many files, all `<Diff>` components render at once, each triggering pierre diff computation. The worker pool has only 2 workers, so they queue up and block.

### 5. Webview equality check is O(n × content_size) (MEDIUM)

**Location:** `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx:1220-1231`

Every poll message triggers full string comparison of `before` and `after` for all files on the UI thread.

### 6. No lazy loading of file content (MEDIUM)

Server returns all diffs with full content at once. No mechanism to fetch metadata first, then content on demand per file.

## Profiling Results (2 worktrees × 72 files × ~1000 changed lines)

### Aggregate Numbers (90-second repro window)

| Metric                                   | Value              |
| ---------------------------------------- | ------------------ |
| Total diff requests                      | **25**             |
| Total server compute time                | **21.0 seconds**   |
| Total data transferred (server→ext)      | **73.9 MB**        |
| Average request time (72-file worktrees) | **~1,090ms**       |
| Peak concurrent requests                 | **5 simultaneous** |
| Data per 72-file worktree request        | **4.93 MB**        |

### Per-Request Time Breakdown (72-file worktree)

| Phase                       | Normal (1 req) | Under contention (5 concurrent) |
| --------------------------- | -------------- | ------------------------------- |
| `git merge-base`            | 15ms           | 19ms                            |
| `git diff --name-status`    | 22ms           | **472ms** (21× slower)          |
| `git diff --numstat`        | 35ms           | **478ms** (14× slower)          |
| Sequential file reads (72×) | **950ms**      | **1,000ms**                     |
| Untracked file scan         | 30ms           | 40ms                            |
| **Total**                   | **~1,050ms**   | **~1,236ms**                    |

### Thundering Herd Pattern

Three independent callers hit the same endpoint simultaneously:

```
Caller                              Interval    Data fetched
─────────────────────────────────────────────────────────────
pollDiff (active session)           2.5s        4.93 MB (72 files, full content)
GitStatsPoller.worktreeStats        5.0s        4.93 MB × N worktrees (full content, needs only 3 numbers)
GitStatsPoller.localStats           5.0s        4.93 MB (full content, needs only 3 numbers)
```

Timeline example — 10:28:49, all timers align:

```
10:28:49  active=1  START  kilo-...361480   ← pollDiff (previous still running!)
10:28:49  active=2  START  kilo-...361480   ← pollDiff overlapping fire
10:28:49  active=3  START  kilo-...423773   ← GitStatsPoller worktree 1
10:28:49  active=4  START  kilo-...625914   ← GitStatsPoller worktree 2
10:28:49  active=5  START  /kilocode        ← GitStatsPoller local
                    → 5 concurrent requests, ~25MB total, git lock contention
```

### Request Duplication

Same worktree `kilo-1773223361480` was requested **11 times** in 90 seconds.
The data was identical every time (72 files, 4.93MB, nothing changed).

### Session-Switch Analysis

When switching between sessions:

1. `startDiffPolling` fires for new session → new `onRequestWorktreeDiff` (1.1s, 4.93MB)
2. GitStatsPoller was already mid-cycle → continues fetching all worktrees (2-3 × 1.1s, 4.93MB each)
3. Previous `pollDiff` interval may still be running → overlapping request
4. **Result: 4-5 overlapping requests each taking >1s, total ~25MB, git contention makes each slower**

### Root Causes Confirmed by Logs

1. **Sequential file reads: 90% of request time** — 950ms of every 1,050ms request is the sequential `git show` + `Bun.file` loop for 72 files.

2. **GitStatsPoller wastes ~60% of total server capacity** — ~14 of 25 requests serve only the stats poller, which downloads full 4.93MB payloads to compute 3 numbers (files/additions/deletions).

3. **No inflight dedup / no busy guard** — The same worktree is requested multiple times concurrently. Poll interval (2.5s) fires before the previous request (~1.1s) completes, but combined with contention delays, requests pile up.

4. **Git lock contention under concurrency** — `git diff --name-status` slows from 22ms to 472ms (21×) when 5 requests run concurrently against the same repo. Git's internal locking serializes concurrent reads on shared index/pack files.

5. **No caching across callers** — pollDiff and GitStatsPoller both fetch the exact same endpoint for the same worktree independently. Neither knows about the other's data.

## Recommended Optimizations

### Quick wins (would eliminate ~70% of the problem)

- **Parallelize server file reads** with `Promise.all` + concurrency limit (e.g. 10). Would cut the 950ms sequential phase to ~100-150ms.
- **Add stats-only endpoint** — `GET /experimental/worktree/stats` running only `git diff --numstat` (no file content). GitStatsPoller would take ~50ms instead of 1,100ms per worktree.
- **Add busy guard to pollDiff** — skip poll if previous request is still in-flight. Prevents the overlapping-fire pattern seen at 10:28:49.
- **Fix hashFileDiffs** — remove `diff.after` from hash. Use `file:status:additions:deletions` only. Eliminates multi-MB string construction on every poll.

### Medium effort

- **Share diff data between pollDiff and GitStatsPoller** — when pollDiff fetches a worktree, cache the result so GitStatsPoller can derive stats from it instead of making a separate request.
- **Serialize GitStatsPoller requests** — instead of `Promise.all` across all worktrees (which creates the thundering herd), fetch worktrees sequentially or with a concurrency limit of 1.
- **Lazy-load file contents** — metadata first, content on accordion expand.
- **Increase poll interval** to 5-10s, or dynamically based on last request duration.
- **Stagger Diff rendering** via requestIdleCallback batches.
- **Match desktop large-diff gate** — block rendering until user opts in (>500 changed lines).

### Longer term

- **Server-side unified diff** — send `git diff -p` patches instead of full before/after.
- **SSE events for worktree diffs** — eliminate polling entirely.
- **Chunked/paginated transfer** for large diffs.
