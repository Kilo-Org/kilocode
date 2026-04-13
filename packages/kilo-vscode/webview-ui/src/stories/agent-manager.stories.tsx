/** @jsxImportSource solid-js */
/**
 * Stories for Agent Manager components:
 * FileTree, DiffPanel, FullScreenDiffView, WorktreeItem
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { FileTree } from "../../agent-manager/FileTree"
import { DiffPanel } from "../../agent-manager/DiffPanel"
import { FullScreenDiffView } from "../../agent-manager/FullScreenDiffView"
import { WorktreeItem } from "../../agent-manager/WorktreeItem"
import type { WorktreeFileDiff, WorktreeState, WorktreeGitStats, PRStatus } from "../types/messages"
import "../../agent-manager/agent-manager.css"
import "../../agent-manager/agent-manager-review.css"

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const mockDiffs: WorktreeFileDiff[] = [
  {
    file: "src/components/chat/ChatView.tsx",
    status: "modified",
    additions: 12,
    deletions: 4,
    before: `import { Component } from "solid-js"\n\nexport const ChatView: Component = () => {\n  return <div class="chat-view" />\n}\n`,
    after: `import { Component, createSignal } from "solid-js"\n\nexport const ChatView: Component = () => {\n  const [open, setOpen] = createSignal(false)\n  return <div class="chat-view" />\n}\n`,
  },
  {
    file: "src/components/chat/MessageList.tsx",
    status: "modified",
    additions: 3,
    deletions: 1,
    before: `export const MessageList = () => <div class="message-list" />\n`,
    after: `export const MessageList = () => (\n  <div class="message-list" role="log" aria-live="polite" />\n)\n`,
  },
  {
    file: "src/stories/chat.stories.tsx",
    status: "added",
    additions: 80,
    deletions: 0,
    before: "",
    after: `/** @jsxImportSource solid-js */\nimport type { Meta } from "storybook-solidjs-vite"\nconst meta: Meta = { title: "Chat" }\nexport default meta\n`,
  },
]

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "AgentManager",
  parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------

export const FileTreeWithChanges: Story = {
  name: "FileTree — with modifications and additions",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "400px", overflow: "auto" }}>
        <FileTree diffs={mockDiffs} activeFile="src/components/chat/ChatView.tsx" onFileSelect={() => {}} showSummary />
      </div>
    </StoryProviders>
  ),
}

export const FileTreeEmpty: Story = {
  name: "FileTree — no changes",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "400px" }}>
        <FileTree diffs={[]} activeFile={null} onFileSelect={() => {}} />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// DiffPanel
// ---------------------------------------------------------------------------

export const DiffPanelWithDiffs: Story = {
  name: "DiffPanel — with diffs (unified)",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "500px", display: "flex", "flex-direction": "column" }}>
        <DiffPanel
          diffs={mockDiffs}
          loading={false}
          diffStyle="unified"
          onDiffStyleChange={() => {}}
          comments={[]}
          onCommentsChange={() => {}}
          onClose={() => {}}
          onExpand={() => {}}
        />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// FullScreenDiffView
// ---------------------------------------------------------------------------

export const FullScreenDiffWithChanges: Story = {
  name: "FullScreenDiffView — with changes",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "700px", display: "flex" }}>
        <FullScreenDiffView
          diffs={mockDiffs}
          loading={false}
          diffStyle="unified"
          onDiffStyleChange={() => {}}
          comments={[]}
          onCommentsChange={() => {}}
          onClose={() => {}}
        />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// WorktreeItem — shared mock helpers
// ---------------------------------------------------------------------------

const noop = () => {}

const baseWorktree: WorktreeState = {
  id: "wt-abc123",
  branch: "feat/inline-delete",
  path: "/tmp/worktrees/feat-inline-delete",
  parentBranch: "main",
  remote: "origin",
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
}

const baseStats: WorktreeGitStats = {
  worktreeId: "wt-abc123",
  files: 4,
  additions: 32,
  deletions: 8,
  ahead: 2,
  behind: 0,
}

const defaultProps = {
  worktree: baseWorktree,
  label: "feat/inline-delete",
  active: false,
  pendingDelete: false,
  busy: false,
  working: false,
  stale: false,
  shortcut: 2,
  sessions: 1,
  grouped: false,
  groupStart: false,
  groupEnd: false,
  groupSize: 0,
  renaming: false,
  renameValue: "",
  closeKeybind: "⌘⇧W",
  openKeybind: "⌘⇧O",
  onClick: noop,
  onDelete: noop,
  onStartRename: noop,
  onRenameInput: noop,
  onCommitRename: noop,
  onCancelRename: noop,
  onRemoveStale: noop,
  onCopyPath: noop,
  onOpen: noop,
}

// ---------------------------------------------------------------------------
// WorktreeItem stories
// ---------------------------------------------------------------------------

export const WorktreeItemDefault: Story = {
  name: "WorktreeItem — default",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} />
      </div>
    </StoryProviders>
  ),
}

export const WorktreeItemActive: Story = {
  name: "WorktreeItem — active",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} active />
      </div>
    </StoryProviders>
  ),
}

export const WorktreeItemPendingDelete: Story = {
  name: "WorktreeItem — pending delete",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} active pendingDelete />
      </div>
    </StoryProviders>
  ),
}

export const WorktreeItemBusy: Story = {
  name: "WorktreeItem — busy (spinner)",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} busy />
      </div>
    </StoryProviders>
  ),
}

export const WorktreeItemStale: Story = {
  name: "WorktreeItem — stale",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stale />
      </div>
    </StoryProviders>
  ),
}

export const WorktreeItemWithStats: Story = {
  name: "WorktreeItem — with git stats",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stats={baseStats} />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// PR badge mock helpers
// ---------------------------------------------------------------------------

const basePR: PRStatus = {
  number: 8594,
  title: "feat: add inline delete",
  url: "https://github.com/org/repo/pull/8594",
  state: "open",
  review: null,
  checks: { status: "success", total: 5, passed: 5, failed: 0, pending: 0, items: [] },
  additions: 978,
  deletions: 202,
  files: 12,
}

// ---------------------------------------------------------------------------
// WorktreeItem — PR badge stories
// ---------------------------------------------------------------------------

export const PRBadgeApproved: Story = {
  name: "PR Badge — approved + checks pass",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stats={baseStats} pr={{ ...basePR, review: "approved" }} />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgePending: Story = {
  name: "PR Badge — pending review",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stats={baseStats} pr={{ ...basePR, review: "pending" }} />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgeChangesRequested: Story = {
  name: "PR Badge — changes requested",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stats={baseStats} pr={{ ...basePR, review: "changes_requested" }} />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgeChecksFailing: Story = {
  name: "PR Badge — checks failing",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem
          {...defaultProps}
          stats={baseStats}
          pr={{ ...basePR, checks: { ...basePR.checks, status: "failure", passed: 3, failed: 2 } }}
        />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgeChecksPending: Story = {
  name: "PR Badge — checks pending",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem
          {...defaultProps}
          stats={baseStats}
          pr={{ ...basePR, checks: { ...basePR.checks, status: "pending", passed: 2, pending: 3 } }}
        />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgeDraft: Story = {
  name: "PR Badge — draft",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stats={baseStats} pr={{ ...basePR, state: "draft" }} />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgeMerged: Story = {
  name: "PR Badge — merged",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stats={baseStats} pr={{ ...basePR, state: "merged" }} />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgeClosed: Story = {
  name: "PR Badge — closed",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stats={baseStats} pr={{ ...basePR, state: "closed" }} />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgeNoReview: Story = {
  name: "PR Badge — open, no review decision",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem {...defaultProps} stats={baseStats} pr={basePR} />
      </div>
    </StoryProviders>
  ),
}

export const PRBadgeApprovedChecksFailing: Story = {
  name: "PR Badge — approved but checks failing",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ width: "200px" }}>
        <WorktreeItem
          {...defaultProps}
          stats={baseStats}
          pr={{ ...basePR, review: "approved", checks: { ...basePR.checks, status: "failure", passed: 3, failed: 2 } }}
        />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// WorktreeItem — grouped
// ---------------------------------------------------------------------------

export const WorktreeItemGrouped: Story = {
  name: "WorktreeItem — grouped (3 versions)",
  render: () => {
    const group: WorktreeState[] = [
      { ...baseWorktree, id: "wt-g1", branch: "feat/v1", groupId: "g1" },
      { ...baseWorktree, id: "wt-g2", branch: "feat/v2", groupId: "g1" },
      { ...baseWorktree, id: "wt-g3", branch: "feat/v3", groupId: "g1" },
    ]
    return (
      <StoryProviders noPadding>
        <div style={{ width: "200px" }}>
          <WorktreeItem
            {...defaultProps}
            worktree={group[0]}
            label="feat/v1"
            grouped
            groupStart
            groupEnd={false}
            groupSize={3}
            shortcut={2}
          />
          <WorktreeItem
            {...defaultProps}
            worktree={group[1]}
            label="feat/v2"
            grouped
            groupStart={false}
            groupEnd={false}
            groupSize={0}
            shortcut={3}
          />
          <WorktreeItem
            {...defaultProps}
            worktree={group[2]}
            label="feat/v3"
            grouped
            groupStart={false}
            groupEnd
            groupSize={0}
            shortcut={4}
          />
        </div>
      </StoryProviders>
    )
  },
}
