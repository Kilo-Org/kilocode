# Plan: Exclude Generated Files from Agent Manager Diff Views

## Problem

When a worktree contains untracked generated directories (e.g. `node_modules/`, `dist/`, `target/`), the Agent Manager diff pipeline fetches **every file** — including thousands of vendor files — and sends them to the webview. This causes:

1. **Server overload**: The endpoint reads the full content of every file (`Bun.file().text()`). For a typical `node_modules/` this means reading 10,000+ files.
2. **Massive JSON payloads**: The HTTP response can be hundreds of megabytes.
3. **Webview crash/freeze**: The diff viewer creates DOM nodes for every file.
4. **Misleading stats**: Sidebar badges show inflated numbers like "+500,000 lines".
5. **Apply Dialog noise**: Vendor files mixed in with real changes.

### Why This Happens

Agent worktrees are fresh git branches. When an agent runs `npm install` or a build step, the resulting directories are untracked. `git ls-files --others --exclude-standard` picks them up. If there is no `.gitignore` in the worktree, `--exclude-standard` has nothing to exclude.

## Current State

| Component                      | File                                      | Behavior                                                                          |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Server endpoint                | `experimental.ts:193-339`                 | Returns ALL files. Zero filtering. Reads full content for every entry.            |
| FileIgnore module              | `file/ignore.ts`                          | Has `FOLDERS` set + `FILES` globs + `match()`. **Not used by the diff endpoint.** |
| diff-open-policy               | `diff-open-policy.ts`                     | Files >400 changed lines auto-collapsed. Still in DOM.                            |
| GitStatsPoller                 | `GitStatsPoller.ts`                       | Sums all files for sidebar badges. No filtering.                                  |
| DiffPanel / FullScreenDiffView | `DiffPanel.tsx`, `FullScreenDiffView.tsx` | Renders every file.                                                               |
| ApplyDialog                    | `ApplyDialog.tsx`                         | Shows every file with checkboxes.                                                 |

## Classification: Three Deterministic Layers

No heuristics. Each layer is a deterministic pattern match — given a path, it either matches or it doesn't.

### Layer 1: `.gitignore` (already works for untracked files)

`git ls-files --others --exclude-standard` already respects `.gitignore`. If the repo has one, untracked vendor directories are never reported. No code change needed for this case.

For **committed** files that later got added to `.gitignore` (rare but possible), we can use `git check-ignore` to test paths.

### Layer 2: `.gitattributes` `linguist-generated`

GitHub's convention. Files marked `linguist-generated=true` are generated. Example:

```gitattributes
*.pb.go linguist-generated=true
src/generated/** linguist-generated=true
```

Parse `.gitattributes` from the worktree root. Any matching file is generated.

### Layer 3: `FileIgnore.match()` (fallback for repos with no ignore config)

The existing module at `packages/opencode/src/file/ignore.ts` has a deterministic set of folder names and file patterns. A file matches or it doesn't — no thresholds, no percentages.

This is the safety net for the core scenario: **the agent scaffolded a new project and there is no `.gitignore` yet.** The `FileIgnore.FOLDERS` set already covers directories across all ecosystems:

- JS/TS: `node_modules`, `bower_components`, `.pnpm-store`, `.npm`
- Python: `__pycache__`, `.pytest_cache`, `mypy_cache`
- Rust: `target`
- Java/Kotlin: `.gradle`
- .NET: `obj`
- General: `dist`, `build`, `out`, `.next`, `.output`, `.turbo`, `.cache`

Some entries in the current set need review for the diff context (`bin`, `desktop` are too ambiguous — audit needed before using the full set).

### How the layers compose

```
For each file in the diff:
  1. Matches .gitignore?           → generated
  2. Matches .gitattributes?       → generated
  3. Matches FileIgnore.match()?   → generated
  4. None of the above             → reviewable
```

All three layers are deterministic. No confidence levels, no volume heuristics.

### Lock files

Lock files are NOT classified as generated unless they match the repo's `.gitignore`. They stay in the main file list. The existing >400 lines auto-collapse handles the UX (they're collapsed, user can expand).

## Implementation

One change, server + client together.

### Server: `experimental.ts`

1. Before the file-content loop, classify each path using layers 1-3.
2. For generated files: collect path/status/stats from `--name-status` and `--numstat` only. **Skip `Bun.file().text()` and `git show`**.
3. Return a new response shape:

```ts
{
  diffs: FileDiff[],        // reviewable files, full content
  generated: {
    files: number,
    additions: number,
    deletions: number,
    entries: { file: string, status: string, additions: number, deletions: number }[]
  }
}
```

Add `exclude` query param: `generated` (default) or `none` (returns everything, current behavior). This keeps backward compat — existing callers that don't send `exclude` get the new filtered response, and passing `exclude=none` gets the old flat array behavior.

### Extension: `AgentManagerProvider.ts`

Parse the new response. Post `agentManager.worktreeDiff` with reviewable files only. Post `agentManager.worktreeDiffGenerated` with the generated summary.

### Extension: `GitStatsPoller.ts`

Use reviewable file count for badge numbers. Optionally show generated count separately.

### Webview: `DiffPanel.tsx` / `FullScreenDiffView.tsx`

Show reviewable files as normal. At the bottom, render a collapsed summary section:

```
┌─────────────────────────────────────────────────┐
│  src/index.ts                        +12  -3    │
│  src/utils.ts                        +45  -12   │
│  package.json                        +2   -1    │
│                                                 │
│  ▸ 1,247 generated files hidden   +98,432  -0  │
└─────────────────────────────────────────────────┘
```

The summary section:

- Always collapsed by default
- Shows file count + aggregate stats
- When expanded, shows folder-level groups (e.g. "node_modules/ — 1,200 files") not individual files
- No `<Diff>` components — there is no content

### Webview: `ApplyDialog.tsx`

Exclude generated files from selection. Show info note: "N generated files excluded".

### Webview: header stats

```
5 files changed  +57  -12   (1,247 generated files hidden)
```

## Files to Modify

| File                                                                   | Change                                                         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `packages/opencode/src/file/ignore.ts`                                 | Audit `FOLDERS` for diff context, add `.gitattributes` parsing |
| `packages/opencode/src/server/routes/experimental.ts`                  | Classification + filtering + new response shape                |
| `packages/opencode/src/snapshot/index.ts`                              | Add `GeneratedSummary` Zod schema                              |
| SDK regeneration (`./script/generate.ts`)                              | Regen types                                                    |
| `packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts`       | Handle new response, post generated summary                    |
| `packages/kilo-vscode/src/agent-manager/GitStatsPoller.ts`             | Use reviewable counts for badges                               |
| `packages/kilo-vscode/webview-ui/src/types/messages.ts`                | Add generated summary message type                             |
| `packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx`          | Render generated summary section                               |
| `packages/kilo-vscode/webview-ui/agent-manager/FullScreenDiffView.tsx` | Same                                                           |
| `packages/kilo-vscode/webview-ui/agent-manager/ApplyDialog.tsx`        | Exclude generated from selection                               |

## Edge Cases

### No `.gitignore` (new project scaffolded by agent)

```
package.json          ← reviewable (not in FileIgnore)
src/index.ts          ← reviewable
src/App.tsx           ← reviewable
tsconfig.json         ← reviewable
node_modules/         ← generated (FileIgnore.FOLDERS match)
package-lock.json     ← reviewable (not a folder match, shows collapsed if >400 lines)
```

The user sees the agent's actual work. `node_modules/` is a summary line.

### Other cases

- **Committed `node_modules/`**: Generated by FileIgnore match. Summary shows stats. User can re-fetch with `exclude=none` if needed.
- **Lock file as only change**: Stays in main list. Not empty. Auto-collapsed if large.
- **`dist/` is real code**: User adds it to a project-level allowlist (future enhancement) or re-fetches with `exclude=none`.
- **Nested `node_modules/`**: Path-segment match handles it — `packages/foo/node_modules/bar/index.js` matches.
- **Protobuf/codegen output**: User marks in `.gitattributes` as `linguist-generated=true`. FileIgnore fallback won't catch arbitrary codegen filenames — that's correct, since codegen is sometimes reviewed.
- **Custom vendor dir (`third_party/`)**: Not in FileIgnore. User adds to `.gitignore` or `.gitattributes`. No magic.

## Open Questions

1. **`FileIgnore.FOLDERS` audit**: `bin`, `desktop`, `.sst` are currently in the set. These could be legitimate project directories. Need to decide: use the full set, or create a strict subset for the diff endpoint?
2. **Response migration**: New response shape vs. adding a `generated: boolean` flag to each `FileDiff` (simpler but still sends entries for thousands of files). Leaning toward new shape since the whole point is to not send content.
3. **Git command perf**: Should we also add pathspec exclusions to the git commands themselves (e.g. `-- ':(exclude)node_modules'`) or is filtering the output sufficient? The `--name-status` + `--numstat` calls are fast, but `git ls-files --others` can be slow with 10k+ untracked files.
