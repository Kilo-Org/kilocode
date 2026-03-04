/** @jsxImportSource solid-js */
/**
 * Stories for Agent Manager components:
 * FileTree, DiffPanel, FullScreenDiffView
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { FileTree } from "../../agent-manager/FileTree"
import { DiffPanel } from "../../agent-manager/DiffPanel"
import { FullScreenDiffView } from "../../agent-manager/FullScreenDiffView"
import type { WorktreeFileDiff } from "../types/messages"

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

export const FullScreenDiffLoading: Story = {
  name: "FullScreenDiffView — loading",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "700px", display: "flex" }}>
        <FullScreenDiffView
          diffs={[]}
          loading
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
// AgentManagerApp
// ---------------------------------------------------------------------------
