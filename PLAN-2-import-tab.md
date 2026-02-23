# Plan 2: Import Tab — Open from PR, Branch, or Worktree

## Context

This is for the **Agent Manager** in the **VS Code extension** (`packages/kilo-vscode/`). The Agent Manager is a webview panel that manages git worktrees for AI agent sessions. It uses **SolidJS** for the UI and communicates with the extension backend via `postMessage`.

The "Advanced..." dialog (`NewWorktreeDialog` in `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx`) already has a tab switcher with "New" and "Import" tabs. **This plan implements the Import tab.**

## CRITICAL: Reference Implementation

Before implementing anything, **thoroughly study the reference implementation** at `/Users/marius/Documents/git/superset`. This project has the exact same "Open Workspace" modal with New/Import/Cloud tabs. You must:

1. Find the "Open Workspace" modal component in the superset codebase
2. Study exactly how each Import section behaves:
   - **PR URL + Open button**: What happens when you click Open? Does it immediately create a worktree, or does it resolve the PR and show a preview first?
   - **Branch selector**: What happens when you click a branch? Immediate creation, or selection + confirm?
   - **Worktree selector**: What happens when you click a worktree? Immediate import?
   - **Import all external worktrees**: What feedback does it give?
3. Study edge case handling: branch already checked out, PR not found, gh not installed, etc.
4. **Replicate the exact same behavior** in our codebase, but using our kilo-ui theme and component patterns

Do NOT reference the superset project anywhere in code or comments. Just match the behavior.

---

## Current State

The `NewWorktreeDialog` component in `AgentManagerApp.tsx` already has:

- A tab switcher (`am-tab-switcher`) with "New" and "Import" pills
- The "New" tab is fully implemented (prompt, versions, advanced options with branch name + base branch)
- The "Import" tab currently shows placeholder content that needs to be replaced

### Existing backend infrastructure (in WorktreeManager.ts):

- `listBranches()` — returns `{ branches: BranchInfo[], defaultBranch: string }` with local/remote info + commit dates
- `listExternalWorktrees()` — returns external worktrees (on-disk but not managed by us)
- `createFromPR(url)` — parses GitHub PR URL via `gh` CLI, fetches the branch
- `createWorktree({ existingBranch })` — can create a worktree from an existing branch
- `branchExists(name)` — checks if a branch exists locally or remotely

### Existing message types (in messages.ts):

- `RequestBranchesMessage` / `AgentManagerBranchesMessage` — request/response for branch list
- `RequestExternalWorktreesMessage` / `AgentManagerExternalWorktreesMessage` — request/response for external worktrees
- `ImportFromBranchRequest` — import from an existing branch
- `ImportFromPRRequest` — import from a PR URL
- `ImportExternalWorktreeRequest` — import a single external worktree
- `ImportAllExternalWorktreesRequest` — import all external worktrees
- `AgentManagerImportResultMessage` — result feedback

### Existing provider handlers (in AgentManagerProvider.ts):

- `onRequestBranches()` — fetches and sends branch list
- `onRequestExternalWorktrees()` — fetches and sends external worktree list
- `onImportFromBranch(branch)` — creates worktree from existing branch
- `onImportFromPR(url)` — resolves PR and creates worktree
- `onImportExternalWorktree(path, branch)` — registers an external worktree
- `onImportAllExternalWorktrees()` — batch imports all external worktrees

**All backend + message plumbing is already in place.** You only need to implement the Import tab UI and wire it to the existing message infrastructure.

---

## What to Implement

### Import Tab UI (inside `NewWorktreeDialog`)

The Import tab should have three sections separated by dividers:

#### 1. Pull Request Section

- Section label: "PULL REQUEST" (uppercase, muted, small text — use `am-nv-config-label` class)
- Row: Input field with branch icon + placeholder "Paste PR URL..." + "Open" button
- Behavior: Study the superset implementation to match exactly

#### 2. Branches Section

- Section label: "BRANCHES"
- A trigger button that opens a searchable dropdown popover
- Shows branch icon + "Select branch..." + chevron
- Dropdown contains:
  - Search input with magnifying glass icon
  - Branch list with: branch icon, name (monospace), "default" badge, "remote" badge, relative time
- Behavior: Study the superset implementation to match exactly

#### 3. Worktrees Section

- Section label: "WORKTREES"
- A trigger button that opens a searchable dropdown popover
- Shows branch icon + "Select worktree..." + count badge + chevron
- Dropdown contains:
  - Search input with magnifying glass icon
  - "External" group header
  - Worktree items with: branch icon, branch name, full path in smaller muted text
- "Import all external worktrees (N)" button below the selector
- Behavior: Study the superset implementation to match exactly

### CSS

All CSS is in `packages/kilo-vscode/webview-ui/agent-manager/agent-manager.css`. Existing CSS classes to reuse:

- `am-nv-config-label` — section labels
- `am-nv-dialog` — dialog container
- `am-import-tab`, `am-import-section`, `am-import-divider` — import layout
- `am-pr-row`, `am-pr-input-wrapper`, `am-pr-input` — PR URL input
- `am-branch-selector-wrapper`, `am-branch-selector-trigger`, `am-branch-selector-value` — selector triggers
- `am-branch-dropdown`, `am-branch-search`, `am-branch-search-input`, `am-branch-list` — dropdowns
- `am-branch-item`, `am-branch-item-name`, `am-branch-item-time`, `am-branch-badge` — list items
- `am-branch-group-label`, `am-branch-empty` — groups and empty states
- `am-worktree-item-import`, `am-worktree-item-info`, `am-worktree-item-path`, `am-worktree-count` — worktree items
- `am-import-all-btn` — import all button
- `am-nv-spinner` — loading spinner

### Available UI Components (from kilo-ui)

- `Icon` — SVG icons (names: "branch", "magnifying-glass", "selector", "chevron-down", etc.)
- `Button` — buttons with variants ("primary", "secondary")
- `Spinner` — loading spinner
- `Dialog` — the dialog wrapper (already used)
- `Toast` — for error/success messages

### Message flow

The webview communicates with the extension via `vscode.postMessage()`:

```ts
// Request data
vscode.postMessage({ type: "agentManager.requestBranches" })
vscode.postMessage({ type: "agentManager.requestExternalWorktrees" })

// Import actions
vscode.postMessage({ type: "agentManager.importFromPR", url: "https://github.com/..." })
vscode.postMessage({ type: "agentManager.importFromBranch", branch: "feature/foo" })
vscode.postMessage({ type: "agentManager.importExternalWorktree", path: "/path/to/wt", branch: "main" })
vscode.postMessage({ type: "agentManager.importAllExternalWorktrees" })

// Listen for responses
window.addEventListener("message", (e) => {
  if (e.data.type === "agentManager.branches") {
    /* branch list */
  }
  if (e.data.type === "agentManager.externalWorktrees") {
    /* worktree list */
  }
  if (e.data.type === "agentManager.importResult") {
    /* success/failure */
  }
})
```

---

## Edge Cases to Handle

| Case                                           | Handling                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| PR URL format variations                       | Normalize: add https://, strip trailing /, handle www.github.com |
| Non-GitHub PR URLs                             | Error: "Only GitHub PR URLs are supported"                       |
| PR from a fork (cross-repo)                    | Backend handles this — just show the error if it fails           |
| Branch already checked out in another worktree | Backend returns error; show as toast                             |
| `gh` CLI not installed                         | Backend returns error; show as toast                             |
| `gh` not authenticated                         | Backend returns error; show as toast                             |
| External worktree path no longer exists        | Backend validates; show error                                    |
| Worktree on a detached HEAD                    | Show "(detached)" instead of branch name                         |
| No external worktrees                          | Hide the "Import all" button; show empty state                   |
| No branches available                          | Show empty state                                                 |
| Loading states                                 | Show spinner on buttons/triggers while requests are in flight    |

---

## Files to Modify

| File                                                                | Change                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/kilo-vscode/webview-ui/agent-manager/AgentManagerApp.tsx` | Replace Import tab placeholder with full implementation |
| `packages/kilo-vscode/webview-ui/agent-manager/agent-manager.css`   | Add/adjust CSS for Import tab components                |

All backend, message types, and provider handlers are already implemented. The CSS classes listed above already exist. You should only need to modify the two files above.

---

## Build & Verify

```bash
cd packages/kilo-vscode
bun run check-types   # tsc --noEmit
bun run lint          # eslint src
node esbuild.js       # bundles extension + webviews
```

All three must pass with 0 errors (pre-existing warnings are OK).
