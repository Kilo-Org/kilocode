# Full-Screen Diff Viewer Tab for Agent Manager

## Problem

The current diff viewer in the Agent Manager opens as a **side panel** to the right of the chat area. While functional, it has limited screen real estate — users can't comfortably review large diffs, navigate between files, or do thorough code reviews. There's no file tree for navigation, no side-by-side diff option, and commenting feels cramped.

## Goal

Add a **full-screen diff viewer** that opens as a **new tab** in the Agent Manager's tab bar (alongside session tabs). This gives users a dedicated review workspace with a file tree, toggleable side-by-side diffs, inline commenting, and maximum screen space — similar to a GitHub PR review experience.

---

## UI Design

### Entry Point: "Expand" Button on Existing Diff Panel

Add a small **expand/fullscreen icon button** to the existing `DiffPanel` header (top-right, next to the close button). When clicked, it:

1. Closes the side diff panel
2. Opens a new tab in the current worktree's tab bar labeled **"Review"**
3. Switches focus to that new tab

The tab appears in the tab bar alongside existing session tabs, but renders a completely different view instead of `ChatView`.

```
┌──────────────────────────────────────────────────────────────┐
│ Sidebar  │  [Session 1] [Session 2] [✦ Review]  [+]         │
│          │───────────────────────────────────────────────────│
│ ▸ Local  │  ┌─────────────┬──────────────────────────────┐  │
│          │  │ File Tree    │  Diff Viewer                 │  │
│ Worktrees│  │              │                              │  │
│ ▸ feat-x │  │ ▾ src/       │  src/components/Button.tsx   │  │
│   sess-1 │  │   Button.tsx │  ─────────────────────────── │  │
│   sess-2 │  │   Modal.tsx  │  - const old = "value"       │  │
│   ✦review│  │   index.ts   │  + const new = "value"       │  │
│          │  │ ▾ test/      │                              │  │
│ ▸ fix-y  │  │   Button.ts  │  [Comment box]               │  │
│          │  │              │                              │  │
│          │  │              │  ─────────────────────────── │  │
│          │  │  12 files    │  src/components/Modal.tsx     │  │
│          │  │  +148 / -32  │  ...                         │  │
│          │  └─────────────┴──────────────────────────────┘  │
│          │  [Unified | Split]             [Send All to Chat] │
└──────────────────────────────────────────────────────────────┘
```

### Alternative Entry Point: Tab Bar Action Button

In addition to the expand button on the diff panel, add a **dedicated button** in the `am-tab-actions` area (next to the existing diff toggle `layers` icon and terminal `console` icon). This could be a `screen-full` or `file-diff` icon that directly opens the full-screen review tab without needing the side panel open first.

---

## Full-Screen Review Tab Layout

### Header / Toolbar

A compact toolbar row at the top of the review tab content:

```
┌──────────────────────────────────────────────────────────────┐
│  ◉ Unified  ○ Split  │  ◀ ▲ ▶  │  12 files  +148 / -32    │
│                       │  nav    │  [Collapse All] [Send All] │
└──────────────────────────────────────────────────────────────┘
```

- **Diff style toggle**: `RadioGroup` with "Unified" / "Split" options (reuse the pattern from `packages/ui/src/components/session-review.tsx:293-303`)
- **File navigation arrows**: Previous/Next file buttons for keyboard-driven review
- **Summary stats**: Total file count, additions, deletions
- **Actions**: Collapse/Expand all, "Send All Comments to Chat"

### Left Panel: File Tree

A collapsible sidebar (left side, resizable with `ResizeHandle`) showing changed files in a tree structure:

- **Tree structure**: Files grouped by directory, collapsible folders
- **File status indicators**: Color-coded icons — green (added), yellow (modified), red (deleted)
- **Change counts**: `+N / -N` per file shown inline (reuse `DiffChanges` from kilo-ui)
- **Active file highlight**: Currently-scrolled-to file gets highlighted
- **Click to scroll**: Clicking a file scrolls the diff viewer to that file's accordion
- **Summary footer**: Total files changed, total additions/deletions

The file tree is similar to VS Code's Source Control panel or GitHub's PR file browser.

### Main Panel: Diff Viewer

The central area renders all file diffs in a scrollable list (same accordion pattern as current `DiffPanel`, but with more space):

- **Accordion per file**: Each file has a collapsible header (reuse `StickyAccordionHeader`)
- **Diff rendering**: Uses the existing `Diff` component from `@kilocode/kilo-ui/diff`
- **Side-by-side mode**: When "Split" is selected, each file diff renders in split view via the `diffStyle="split"` prop (already supported by `@pierre/diffs`)
- **Inline commenting**: Same comment system as current `DiffPanel` — click gutter to add comments, edit/delete, "Send to Chat"

### Comment System (Carried Over from DiffPanel)

The commenting system from `DiffPanel.tsx` carries over directly:

- Click line gutter -> draft comment textarea appears as an annotation
- Submit -> `ReviewComment` stored in local signal
- Edit/Delete per-comment
- "Send to Chat" per-comment (dispatches `appendChatBoxMessage` window event to the parent session's chat)
- "Send All to Chat" bulk action in toolbar

---

## Data Model

### Tab Type Extension

Currently, tabs in the Agent Manager are always session tabs (real or pending). The review tab is a new **virtual tab type** that doesn't correspond to a CLI session.

```typescript
// New type to represent tabs in the tab bar
type TabKind = "session" | "pending" | "review"

type TabItem =
  | { kind: "session"; id: string; title: string }
  | { kind: "pending"; id: string; title: string }
  | { kind: "review"; id: string } // one per worktree context

// The review tab's id would be a stable string like `review:{worktreeId}`
```

The review tab:

- Is **per-worktree** (each worktree can have at most one review tab)
- Shows the **worktree-level diff** (all changes in the worktree vs its base branch)
- Uses the same `diffDatas` signal and polling mechanism as the side panel
- Persists across tab switches (stays in the tab bar until explicitly closed)
- Can be drag-reordered like session tabs
- Has a distinctive icon (e.g., `"file-diff"` or `"layers"`) to distinguish it from session tabs

### Diff Data

No new backend data types needed. The existing `WorktreeFileDiff[]` from `getWorktreeDiff()` is sufficient:

```typescript
interface WorktreeFileDiff {
  file: string // relative path
  before: string // full file contents before
  after: string // full file contents after
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}
```

The file tree is derived by parsing the `file` paths into a tree structure:

```typescript
interface FileTreeNode {
  name: string // directory or file name
  path: string // full relative path
  children?: FileTreeNode[] // present for directories
  diff?: WorktreeFileDiff // present for leaf nodes
}

function buildFileTree(diffs: WorktreeFileDiff[]): FileTreeNode[]
```

---

## Implementation Plan

### Phase 1: Review Tab Infrastructure

**Files modified:**

- `AgentManagerApp.tsx` — extend tab model, add review tab rendering
- `DiffPanel.tsx` — add expand button
- `agent-manager.css` — new styles
- `sortable-tab.tsx` — handle review tab variant in drag-and-drop

**Steps:**

1. Add `reviewTabs` signal (`Set<string>` of worktree IDs with open review tabs)
2. Modify tab bar rendering (`<For>` loop around line 1490) to include the review tab when `reviewTabs` contains the current worktree ID
3. Add conditional rendering: when the active tab is a review tab, render `FullScreenDiffView` instead of the `ChatView` + `DiffPanel` layout
4. Add `onExpand` prop to `DiffPanel`, wire up the expand button
5. Start diff polling when a review tab is active (reuse existing `agentManager.startDiffWatch`)

### Phase 2: FullScreenDiffView Component

**New file:** `webview-ui/agent-manager/FullScreenDiffView.tsx`

**Props:**

```typescript
interface FullScreenDiffViewProps {
  diffs: WorktreeFileDiff[]
  loading: boolean
  onClose: () => void
}
```

**Structure:**

```
FullScreenDiffView
├── Toolbar (diff style toggle, stats, actions)
├── ResizeHandle (horizontal, between file tree and diff viewer)
├── FileTree (left panel)
└── DiffContent (right panel — scrollable accordion of file diffs)
```

This component composes the existing `Diff`, `Accordion`, `StickyAccordionHeader`, `DiffChanges`, `FileIcon`, and comment system from `DiffPanel.tsx`. Refactor the shared logic (comment CRUD, annotation building) into a shared hook or utility to avoid duplicating between `DiffPanel` and `FullScreenDiffView`.

### Phase 3: FileTree Component

**New file:** `webview-ui/agent-manager/FileTree.tsx`

**Props:**

```typescript
interface FileTreeProps {
  diffs: WorktreeFileDiff[]
  activeFile: string | null
  onFileSelect: (path: string) => void
}
```

**Implementation:**

- `buildFileTree()` function converts flat file list to nested tree
- Directories are collapsible (local signal state)
- Each file entry shows: `FileIcon`, filename, `DiffChanges` badge, status color
- Clicking a file calls `onFileSelect` -> parent scrolls diff viewer
- Intersection Observer on file accordion headers tracks which file is currently in view -> syncs `activeFile` back

### Phase 4: Side-by-Side / Unified Toggle

- Add `diffStyle` signal with type `"unified" | "split"` (default: `"unified"`)
- Render `RadioGroup` in toolbar with the two options
- Pass `diffStyle` to each `<Diff>` component instance (the `@pierre/diffs` library already supports this — see `packages/ui/src/pierre/index.ts:136`)
- Persist preference in `localStorage` or via extension state message

### Phase 5: Polish and Keyboard

- **Keybinding**: `Cmd+Shift+R` (or similar) to toggle the review tab
- **Tab icon**: Use `"layers"` icon for the review tab (consistent with the diff toggle button)
- **File tree sync**: Use `IntersectionObserver` on accordion headers to highlight the currently-visible file in the tree
- **Persist state**: Remember diff style (unified/split), file tree width, expanded accordion state
- **Auto-refresh**: Review tab shares the existing diff polling (same `createEffect` at `AgentManagerApp.tsx:826-840`)

---

## CSS Additions

All new styles in `agent-manager.css`, following existing `am-*` prefix convention:

```css
/* Review tab */
.am-review-layout       /* root flex container (column) */
.am-review-toolbar      /* top toolbar row */
.am-review-body         /* horizontal split: file tree + diff */
.am-review-diff         /* scrollable diff area */

/* File tree */
.am-file-tree           /* left panel container */
.am-file-tree-group     /* directory group */
.am-file-tree-dir       /* directory row (collapsible) */
.am-file-tree-file      /* file row */
.am-file-tree-active    /* highlighted active file */
.am-file-tree-status-added
.am-file-tree-status-modified
.am-file-tree-status-deleted
.am-file-tree-summary   /* bottom stats bar */

/* Tab variant */
.am-tab-review          /* review tab styling in tab bar */
.am-tab-review-icon     /* icon before "Review" label */
```

---

## Message Protocol

### No new messages needed for core functionality

The review tab reuses:

- `agentManager.startDiffWatch` / `agentManager.stopDiffWatch` — start/stop polling
- `agentManager.worktreeDiff` / `agentManager.worktreeDiffLoading` — receive diff data

### Optional: Persist review tab state

```typescript
// Could be included in existing AgentManagerStateMessage for restore-on-reload
interface ReviewTabState {
  openReviewTabs: string[] // worktree IDs with open review tabs
  diffStyle: "unified" | "split"
  fileTreeWidth: number
}
```

---

## Existing Code Reuse

| What                       | Where                                                     | How to reuse                          |
| -------------------------- | --------------------------------------------------------- | ------------------------------------- |
| Diff rendering             | `@kilocode/kilo-ui/diff` (wraps `@pierre/diffs`)          | Direct import, pass `diffStyle` prop  |
| Side-by-side toggle        | `@pierre/diffs` `diffStyle: "unified" \| "split"`         | Already supported, just pass prop     |
| Accordion + sticky headers | `@kilocode/kilo-ui/accordion`, `sticky-accordion-header`  | Same as current DiffPanel             |
| File icons                 | `@kilocode/kilo-ui/file-icon`                             | Direct import                         |
| Change counts              | `@kilocode/kilo-ui/diff-changes`                          | Direct import for file tree + toolbar |
| Resize handle              | `@kilocode/kilo-ui/resize-handle`                         | Between file tree and diff viewer     |
| Comment annotations        | `DiffPanel.tsx` annotation/comment system                 | Extract to shared utility             |
| Radio group                | `@kilocode/kilo-ui/radio-group`                           | For unified/split toggle              |
| Tab drag-and-drop          | `sortable-tab.tsx` + `@thisbeyond/solid-dnd`              | Extend to handle review tab kind      |
| Diff polling               | `AgentManagerApp.tsx:826-840` + `AgentManagerProvider.ts` | Share same polling mechanism          |

---

## Open Questions

1. **Tab naming**: "Review" vs "Diff" vs "Changes" — which label for the tab?
2. **Multiple review tabs**: One per worktree, or one global at a time?
3. **File tree default state**: Start all directories expanded or collapsed?
4. **Comment persistence**: Should comments survive tab switch / page reload?
5. **Diff scope**: Worktree-level diff (current behavior) or an option to view per-session diff?
