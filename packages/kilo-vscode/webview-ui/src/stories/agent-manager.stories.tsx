/** @jsxImportSource solid-js */
/**
 * Stories for Agent Manager components:
 * FileTree, DiffPanel, FullScreenDiffView, WorktreeItem, TabBar
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, defaultMockData, mockSessionValue, t } from "./StoryProviders"
import { FileTree } from "../../diff-viewer/FileTree"
import { DiffPanel } from "../../agent-manager/DiffPanel"
import { DiffPanelCache } from "../../agent-manager/DiffPanelCache"
import { createReviewComposers } from "../../agent-manager/review-composers"
import { FullScreenDiffView } from "../../diff-viewer/FullScreenDiffView"
import { WorktreeItem } from "../../agent-manager/WorktreeItem"
import { createIntro } from "../../agent-manager/intro/AgentManagerIntro"
import { SessionTab } from "../components/chat/SessionTab"
import { ChatView } from "../components/chat/ChatView"
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
import { SessionContext, useSession } from "../context/session"
import { ServerContext } from "../context/server"
import { WorktreeModeProvider } from "../context/worktree-mode"
import { SidebarSearchMenu } from "../../agent-manager/SidebarSearchMenu"
import { SidebarToggleButton } from "../../agent-manager/SidebarToggleButton"
import { SideTerminalPanel, createTerminalState } from "../../agent-manager/terminal"
import { LOCAL } from "../../agent-manager/navigate"
import type { SidebarSearchItem } from "../../agent-manager/sidebar-search"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { ContextMenu } from "@kilocode/kilo-ui/context-menu"
import { ThinkingSelectorBase } from "../components/shared/ThinkingSelector"
import { DeferredPopover } from "../components/shared/DeferredPopover"
import { ProjectSelect } from "../../agent-manager/ProjectSelect"
import { PRComments } from "../../agent-manager/pr/PRComments"
import type { PRComment } from "../../agent-manager/pr/pr-types"
import { For, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import type {
  AgentProjectSnapshot,
  WorktreeFileDiff,
  WorktreeState,
  WorktreeGitStats,
  PRStatus,
} from "../types/messages"
import type { ReviewComment } from "../../diff-viewer/review-comments"
import { createModeRouter } from "../../agent-manager/mode-router"
import "../../agent-manager/agent-manager.css"
import "../../agent-manager/agent-manager-review.css"
import "../../agent-manager/pr/pr-panel.css"

registerVscodeToolOverrides()

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

const context = Array.from({ length: 36 }, (_, i) => `  const item${i} = values[${i}]\n`).join("")
const foldedDiffs: WorktreeFileDiff[] = [
  {
    file: "src/components/chat/LongReview.ts",
    status: "modified",
    additions: 2,
    deletions: 2,
    before: `export function review(values: string[]) {\n  const title = "Draft"\n${context}  return title\n}\n`,
    after: `export function review(values: string[]) {\n  const title = "Ready"\n${context}  return title.toUpperCase()\n}\n`,
  },
]

const ROWS = 140
function edited(seed: string, file = "src/agent-edit.ts"): WorktreeFileDiff {
  const before = Array.from({ length: ROWS }, (_, i) => `const row${i} = "${seed}-old-${i}"\n`).join("")
  const after = Array.from({ length: ROWS }, (_, i) => `const row${i} = "${seed}-new-${i}"\n`).join("")
  const patch = [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${ROWS} +1,${ROWS} @@`,
    ...before
      .trimEnd()
      .split("\n")
      .map((line) => `-${line}`),
    ...after
      .trimEnd()
      .split("\n")
      .map((line) => `+${line}`),
    "",
  ].join("\n")

  return {
    file,
    status: "modified",
    additions: ROWS,
    deletions: ROWS,
    before,
    after,
    patch,
  }
}

const tail: WorktreeFileDiff = {
  file: "src/target.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  before: "const target = 'before'\n",
  after: "const target = 'after'\n",
  patch:
    "diff --git a/src/target.ts b/src/target.ts\n--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1 +1 @@\n-const target = 'before'\n+const target = 'after'\n",
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "AgentManager",
  parameters: { layout: "padded" },
}
export default meta
type Story = StoryObj

function IntroductionPreview(props: { skipped?: boolean }) {
  const intro = createIntro({
    base: () => "main",
    git: () => true,
    onCreateWorktree: () => {},
    onSelectSession: () => {},
    onShowHistory: () => {},
    reveal: () => {},
    focus: () => {},
  })
  if (props.skipped) intro.dismiss()
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
  const session = {
    ...useSession(),
    sessions: () => [
      {
        id: "intro-search",
        title: "Add settings search",
        createdAt: ago(10),
        updatedAt: ago(5),
      },
      {
        id: "intro-login",
        title: "Fix login validation",
        createdAt: ago(30),
        updatedAt: ago(15),
      },
    ],
  }
  return <SessionContext.Provider value={session}>{intro.render()}</SessionContext.Provider>
}

export const Introduction: Story = {
  name: "Introduction",
  render: () => (
    <StoryProviders>
      <IntroductionPreview />
    </StoryProviders>
  ),
}

export const IntroductionSkipped: Story = {
  name: "Introduction skipped",
  render: () => (
    <StoryProviders>
      <IntroductionPreview skipped />
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// Wide chat layout
// ---------------------------------------------------------------------------

const chatSessionID = "story-agent-manager-chat"
const chatUserID = "story-agent-manager-user"
const chatAssistantID = "story-agent-manager-assistant"
const chatTime = 1_718_000_000_000
const chatDiff = {
  file: "webview-ui/src/styles/chat-layout.css",
  status: "modified" as const,
  additions: 12,
  deletions: 4,
  before: ".chat-view {\n  display: flex;\n}\n",
  after: ".chat-view {\n  display: flex;\n  container: chat / inline-size;\n}\n",
}
const chatMessages = [
  {
    id: chatUserID,
    sessionID: chatSessionID,
    role: "user",
    createdAt: new Date(chatTime).toISOString(),
    time: { created: chatTime },
    summary: { diffs: [chatDiff] },
  },
  {
    id: chatAssistantID,
    sessionID: chatSessionID,
    role: "assistant",
    parentID: chatUserID,
    createdAt: new Date(chatTime + 1000).toISOString(),
    time: { created: chatTime + 1000, completed: chatTime + 5000 },
    modelID: "anthropic/claude-sonnet-4-6",
    providerID: "kilo",
    mode: "default",
    agent: "code",
    path: { cwd: "/project", root: "/project" },
  },
]
const chatParts = {
  [chatUserID]: [
    {
      id: "story-agent-manager-user-text",
      sessionID: chatSessionID,
      messageID: chatUserID,
      type: "text",
      text: "Make the full-screen Agent Manager conversation easier to scan without squeezing tool output or diffs.",
    },
  ],
  [chatAssistantID]: [
    {
      id: "story-agent-manager-assistant-text",
      sessionID: chatSessionID,
      messageID: chatAssistantID,
      type: "text",
      text: "The transcript now follows a centered 78 character reading lane. Long explanations share one consistent left edge, so the eye can move between turns without crossing the entire editor.\n\nTool output and the composer use the same lane, keeping every conversation element aligned.",
    },
    {
      id: "story-agent-manager-bash",
      sessionID: chatSessionID,
      messageID: chatAssistantID,
      type: "tool",
      callID: "story-agent-manager-bash-call",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "bun run test:unit", description: "Run focused Agent Manager tests" },
        output: "18 tests passed\n0 tests failed",
        title: "Run focused Agent Manager tests",
        metadata: {},
        time: { start: chatTime + 2000, end: chatTime + 4000 },
      },
    },
  ],
}
const chatData = {
  ...defaultMockData,
  message: { [chatSessionID]: chatMessages },
  part: chatParts,
}
const chatServer = {
  connectionState: () => "connected" as const,
  serverInfo: () => undefined,
  extensionVersion: () => "1.0.0",
  errorMessage: () => undefined,
  errorDetails: () => undefined,
  isConnected: () => true,
  profileData: () => null,
  providerUsage: () => undefined,
  providerUsageLoading: () => false,
  providerUsageError: () => undefined,
  requestProviderUsage: () => undefined,
  refreshProviderUsage: () => undefined,
  deviceAuth: () => ({ status: "idle" as const }),
  startLogin: () => undefined,
  goToLogin: () => undefined,
  vscodeLanguage: () => "en",
  languageOverride: () => undefined,
  workspaceDirectory: () => "/project",
  gitInstalled: () => true,
}

function renderChat() {
  const session = {
    ...mockSessionValue({ id: chatSessionID, status: "idle", closeReason: "completed" }),
    messages: () => chatMessages,
    visibleMessages: () => chatMessages,
    userMessages: () => chatMessages.filter((message) => message.role === "user"),
    getParts: (id: string) => chatParts[id as keyof typeof chatParts] ?? [],
    worktreeStats: () => ({ files: 3, additions: 32, deletions: 8 }),
  }
  return (
    <StoryProviders data={chatData} sessionID={chatSessionID} status="idle" noPadding>
      <ServerContext.Provider value={chatServer}>
        <SessionContext.Provider value={session as any}>
          <WorktreeModeProvider>
            <div class="am-chat-wrapper" style={{ height: "100vh" }}>
              <ChatView onForkSession={() => undefined} />
            </div>
          </WorktreeModeProvider>
        </SessionContext.Provider>
      </ServerContext.Provider>
    </StoryProviders>
  )
}

export const ReadableChat1280: Story = {
  name: "Chat - readable wide editor",
  parameters: { layout: "fullscreen" },
  render: renderChat,
}

export const ReadableChat420: Story = {
  name: "Chat - constrained editor",
  parameters: { layout: "fullscreen" },
  render: renderChat,
}

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

export const FileTreeVirtualizedLarge: Story = {
  name: "FileTree - virtualized large review",
  render: () => {
    const diffs = Array.from({ length: 600 }, (_, index): WorktreeFileDiff => {
      const group = String(Math.floor(index / 30)).padStart(2, "0")
      const file = String(index).padStart(4, "0")
      return {
        file: `src/group-${group}/file-${file}.ts`,
        before: "",
        after: "",
        patch: "",
        additions: 1,
        deletions: 0,
        status: "modified",
        tracked: true,
        generatedLike: false,
        summarized: true,
      }
    })
    const [selected, setSelected] = createSignal(diffs[0]!.file)

    return (
      <StoryProviders>
        <div data-testid="large-file-tree" data-selected={selected()} style={{ width: "420px", height: "520px" }}>
          <FileTree diffs={diffs} activeFile={selected()} onFileSelect={setSelected} />
        </div>
      </StoryProviders>
    )
  },
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

export const DiffPanelScrollUp: Story = {
  name: "DiffPanel - scroll upward through large diffs",
  render: () => {
    const diffs = Array.from({ length: 5 }, (_, i) => edited(`review-${i}`, `src/review-${i}.ts`))
    return (
      <StoryProviders noPadding>
        <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
          <DiffPanel
            diffs={diffs}
            loading={false}
            sessionKey="inline-scroll-up"
            diffStyle="unified"
            onDiffStyleChange={() => {}}
            comments={[]}
            onCommentsChange={() => {}}
            onClose={() => {}}
          />
        </div>
      </StoryProviders>
    )
  },
}

export const DiffPanelCachedWorktreeSwitch: Story = {
  name: "DiffPanel - switch cached worktrees without blank frames",
  render: () => {
    const ids = Array.from({ length: 12 }, (_, index) => `worktree-${index + 1}`)
    const [current, setCurrent] = createSignal(ids[0]!)
    const values = Object.fromEntries(ids.map((id) => [`single\0${id}#branch`, [edited(id, `src/${id}.ts`)]]))
    const composers = createReviewComposers(() => undefined)
    const comments = [
      {
        id: "cached-comment",
        file: "src/worktree-1.ts",
        side: "additions" as const,
        line: 2,
        comment: "Keep the cached review annotation mounted",
        selectedText: "line 2",
      },
    ]

    return (
      <StoryProviders noPadding>
        <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
          <div data-testid="cached-worktree-tabs">
            {ids.map((id) => (
              <button type="button" data-testid={`select-${id}`} onClick={() => setCurrent(id)}>
                {id}
              </button>
            ))}
          </div>
          <div class="am-diff-panel-wrapper" style={{ flex: 1 }}>
            <DiffPanelCache
              current={() => `${current()}#branch`}
              context={current}
              project={() => undefined}
              active={() => true}
              contexts={() => new Set(ids)}
              data={() => values}
              loading={() => false}
              loadingFiles={() => new Set()}
              notice={() => undefined}
              comments={(key) => (key === "worktree-1#branch" ? comments : [])}
              setComments={() => {}}
              composer={composers.get}
              lead={() => <span>Branch</span>}
              canRevert={false}
              diffStyle="unified"
              onDiffStyleChange={() => {}}
              markdownRender={false}
              onMarkdownRenderChange={() => {}}
              onSendClick={() => {}}
              onClose={() => {}}
              onRequestDiff={() => {}}
              onOpenFile={() => {}}
              onOpenDocument={() => {}}
              onRevertFile={() => {}}
              revertingFiles={() => new Set()}
            />
          </div>
        </div>
      </StoryProviders>
    )
  },
}

export const DiffPanelViewportLoading: Story = {
  name: "DiffPanel - load only visible file details",
  render: () => {
    const [entries, setEntries] = createSignal<WorktreeFileDiff[]>(
      Array.from({ length: 120 }, (_, index) => ({
        file: `src/file-${String(index).padStart(3, "0")}.ts`,
        before: "",
        after: "",
        patch: "",
        additions: 1,
        deletions: 1,
        status: "modified",
        tracked: true,
        generatedLike: false,
        summarized: true,
        stamp: "1:1",
      })),
    )
    const [requested, setRequested] = createSignal<string[]>([])
    const [offscreen, setOffscreen] = createSignal<string[]>([])
    const load = (file: string) => {
      const root = document.querySelector("[data-testid=viewport-diff-review] .am-diff-content")
      const row = root?.querySelector(`[data-file-path="${CSS.escape(file)}"]`)
      if (root && row) {
        const box = root.getBoundingClientRect()
        const rect = row.getBoundingClientRect()
        if (rect.bottom < box.top - 201 || rect.top > box.bottom + 201) setOffscreen((prev) => [...prev, file])
      }
      setRequested((prev) => (prev.includes(file) ? prev : [...prev, file]))
      // Simulate a host reply after the requesting Solid effect has completed.
      queueMicrotask(() => {
        setEntries((prev) =>
          prev.map((item) =>
            item.file === file
              ? {
                  ...item,
                  before: "before\n",
                  after: "after\n",
                  patch: `--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-before\n+after\n`,
                  summarized: false,
                }
              : item,
          ),
        )
      })
    }

    return (
      <StoryProviders noPadding>
        <div
          data-testid="viewport-diff-review"
          data-request-count={requested().length}
          data-requested={requested().join("|")}
          data-offscreen={offscreen().join("|")}
          style={{ height: "700px", display: "flex", "flex-direction": "column" }}
        >
          <DiffPanel
            diffs={entries()}
            loading={false}
            sessionKey="viewport-diff-review"
            diffStyle="unified"
            onDiffStyleChange={() => {}}
            comments={[]}
            onCommentsChange={() => {}}
            onClose={() => {}}
            onRequestDiff={load}
          />
        </div>
      </StoryProviders>
    )
  },
}

export const DiffPanelInterruptedLoading: Story = {
  name: "DiffPanel - resume interrupted visible file",
  render: () => {
    const [active, setActive] = createSignal(true)
    const [count, setCount] = createSignal(0)
    const [loading, setLoading] = createSignal(new Set<string>())
    const [entries, setEntries] = createSignal<WorktreeFileDiff[]>([
      { file: "src/resume.ts", before: "", after: "", patch: "", additions: 1, deletions: 1, summarized: true },
    ])
    const request = (file: string) => {
      setCount((value) => value + 1)
      setLoading(new Set([file]))
      if (count() === 1) return
      // Keep the resumed host reply asynchronous, as in the real request/response path.
      queueMicrotask(() => {
        setEntries([
          {
            ...entries()[0]!,
            before: "before\n",
            after: "after\n",
            patch: "--- a/src/resume.ts\n+++ b/src/resume.ts\n@@ -1 +1 @@\n-before\n+after\n",
            summarized: false,
          },
        ])
        setLoading(new Set<string>())
      })
    }
    return (
      <StoryProviders noPadding>
        <div
          data-testid="interrupted-review"
          data-requests={count()}
          style={{ height: "700px", display: "flex", "flex-direction": "column" }}
        >
          <button
            data-testid="interrupt-review"
            onClick={() => {
              setActive(false)
              setLoading(new Set<string>())
            }}
          >
            Interrupt
          </button>
          <button data-testid="resume-review" onClick={() => setActive(true)}>
            Resume
          </button>
          <div style={{ flex: 1, "min-height": 0, display: "flex", "flex-direction": "column" }}>
            <DiffPanel
              diffs={entries()}
              loading={false}
              active={active()}
              loadingFiles={loading()}
              sessionKey="interrupted-review"
              diffStyle="unified"
              onDiffStyleChange={() => {}}
              comments={[]}
              onCommentsChange={() => {}}
              onClose={() => {}}
              onRequestDiff={request}
            />
          </div>
        </div>
      </StoryProviders>
    )
  },
}

const buttonFixtureStyle: JSX.CSSProperties = {
  display: "inline-flex",
  "align-items": "center",
  gap: "10px",
  padding: "8px",
  background: "var(--surface-base)",
  border: "1px solid var(--border-weak-base)",
  "border-radius": "6px",
}

const buttonFixtureLabelStyle: JSX.CSSProperties = {
  color: "var(--text-weak)",
  "font-size": "var(--font-size-small)",
}

export const InlineDiffBulkActionExpandAllButton: Story = {
  name: "Inline Diff — expand all button",
  render: () => (
    <StoryProviders noPadding>
      <div style={buttonFixtureStyle}>
        <span style={buttonFixtureLabelStyle}>Inline diff action</span>
        <IconButton icon="files-expand" size="small" variant="ghost" label="Expand All" />
      </div>
    </StoryProviders>
  ),
}

export const InlineDiffBulkActionCollapseAllButton: Story = {
  name: "Inline Diff — collapse all button",
  render: () => (
    <StoryProviders noPadding>
      <div style={buttonFixtureStyle}>
        <span style={buttonFixtureLabelStyle}>Inline diff action</span>
        <IconButton icon="files-collapse" size="small" variant="ghost" label="Collapse All" />
      </div>
    </StoryProviders>
  ),
}

export const FullScreenDiffBulkActionExpandAllButton: Story = {
  name: "Full-screen Diff — expand all button",
  render: () => (
    <StoryProviders noPadding>
      <div style={buttonFixtureStyle}>
        <span style={buttonFixtureLabelStyle}>Full-screen diff action</span>
        <Button size="small" variant="ghost">
          <Icon name="chevron-grabber-vertical" size="small" />
          Expand All
        </Button>
      </div>
    </StoryProviders>
  ),
}

export const FullScreenDiffBulkActionCollapseAllButton: Story = {
  name: "Full-screen Diff — collapse all button",
  render: () => (
    <StoryProviders noPadding>
      <div style={buttonFixtureStyle}>
        <span style={buttonFixtureLabelStyle}>Full-screen diff action</span>
        <Button size="small" variant="ghost">
          <Icon name="chevron-grabber-vertical" size="small" />
          Collapse All
        </Button>
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

export const FullScreenDiffWithCollapsedContext: Story = {
  name: "FullScreenDiffView - collapsed unchanged context",
  render: () => (
    <StoryProviders>
      <div style={{ width: "420px", height: "700px", display: "flex" }}>
        <FullScreenDiffView
          diffs={foldedDiffs}
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

export const FullScreenDiffAgentEditScroll: Story = {
  name: "FullScreenDiffView - preserve scroll during agent edit",
  render: () => {
    const [diffs, setDiffs] = createSignal([edited("before"), tail])
    const [version, setVersion] = createSignal("before")
    const [key, setKey] = createSignal("agent-edit-scroll")
    const [comments, setComments] = createSignal<ReviewComment[]>([])
    const update = () => {
      setDiffs([edited("after"), tail])
      setVersion("after")
    }
    const change = () => {
      setDiffs([edited("context"), tail])
      setKey("changed-context")
    }
    return (
      <StoryProviders noPadding>
        <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
          <div style={{ display: "flex", gap: "8px", padding: "4px", "align-items": "center" }}>
            <Button size="small" onClick={update}>
              Apply agent edit
            </Button>
            <Button size="small" onClick={change}>
              Switch review context
            </Button>
            <span data-testid="agent-edit-version">{version()}</span>
            <span data-testid="review-context">{key()}</span>
          </div>
          <div style={{ display: "flex", "min-height": "0", flex: "1" }}>
            <FullScreenDiffView
              diffs={diffs()}
              loading={false}
              sessionKey={key()}
              diffStyle="unified"
              onDiffStyleChange={() => {}}
              comments={comments()}
              onCommentsChange={setComments}
              onClose={() => {}}
            />
          </div>
        </div>
      </StoryProviders>
    )
  },
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
  activity: "idle" as const,
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

const activityStates = [
  ["busy", "Running"],
  ["waiting", "Needs input"],
  ["done", "Completed"],
  ["retry", "Retrying"],
  ["error", "Error"],
  ["idle", "Idle"],
] as const

export const WorktreeActivityStates: Story = {
  name: "Worktree cards - all activity states",
  render: (args: { active?: boolean }) => (
    <StoryProviders noPadding>
      <div data-activity-story style={{ padding: "12px", background: "var(--surface-base)" }}>
        <style>{'[data-activity-story] [data-component="spinner"] rect { animation: none !important; }'}</style>
        <For each={activityStates}>
          {([state, title]) => (
            <WorktreeItem
              {...defaultProps}
              worktree={{
                ...baseWorktree,
                id: `wt-${state}`,
                branch: `feature/${state}`,
                createdAt: "2026-01-01T00:00:00.000Z",
              }}
              label={title}
              subtitle={`feature/${state}`}
              active={args.active === true}
              activity={state}
              stats={{ ...baseStats, worktreeId: `wt-${state}` }}
              shortcut={0}
            />
          )}
        </For>
      </div>
    </StoryProviders>
  ),
}

export const WorktreeActivityStatesActive: Story = {
  ...WorktreeActivityStates,
  name: "Worktree cards - selected activity states",
  args: { active: true },
}

export const SessionTabActivityStates: Story = {
  name: "Agent Manager session tabs - activity states",
  render: () => (
    <StoryProviders noPadding>
      <div data-activity-story style={{ padding: "12px", background: "var(--surface-base)" }}>
        <style>{'[data-activity-story] [data-component="spinner"] rect { animation: none !important; }'}</style>
        <For each={activityStates}>
          {([state, title]) => (
            <div class="am-tab-bar" role="tablist" aria-label={title}>
              <SessionTab
                title={title}
                active
                state={state}
                stateLabel={title}
                closeTitle="Close tab"
                closeLabel="Close tab"
                role="tab"
                selected
                onSelect={noop}
                onMiddleClick={noop}
                onClose={noop}
              />
            </div>
          )}
        </For>
      </div>
    </StoryProviders>
  ),
}

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
  checks: { status: "success", total: 5, passed: 5, failed: 0, pending: 0, checks: [] },
  reviewers: [],
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

export const PRBadgeUnresolved: Story = {
  name: "PR Badge - unresolved review threads",
  render: () => (
    <StoryProviders noPadding>
      <WorktreeItem
        {...defaultProps}
        label="Cache change badge file reads"
        subtitle="fix/change-badge-reads"
        stats={baseStats}
        active
        pr={{ ...basePR, unresolvedThreads: 3 }}
        onOpenComments={noop}
      />
      <WorktreeItem
        {...defaultProps}
        label="Update authentication"
        subtitle="feat/authentication"
        stats={baseStats}
        pr={{ ...basePR, number: 8595, review: "approved", unresolvedThreads: 12 }}
        onOpenComments={noop}
      />
      <WorktreeItem
        {...defaultProps}
        label="Improve settings"
        subtitle="feat/settings"
        stats={baseStats}
        pr={{ ...basePR, number: 8596, state: "draft", unresolvedThreads: 1 }}
        onOpenComments={noop}
      />
      <WorktreeItem
        {...defaultProps}
        label="All feedback resolved"
        subtitle="fix/resolved-feedback"
        stats={baseStats}
        pr={{ ...basePR, number: 8597, unresolvedThreads: 0 }}
      />
    </StoryProviders>
  ),
}

export const PRBadgeUnresolved200: Story = {
  ...PRBadgeUnresolved,
  name: "PR Badge - unresolved review threads, narrow",
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

// ---------------------------------------------------------------------------
// TabBar — renders tab bar structure matching SortableTab / SortableReviewTab
// DOM to verify the tooltip-trigger height chain is correct.
// ---------------------------------------------------------------------------

/**
 * Mock tab matching the real SortableTab DOM:
 *   .am-tab-sortable > [context-menu-trigger] > [tooltip-trigger] > .am-tab
 */
const MockTab = (props: { title: string; active?: boolean }) => (
  <div class="am-tab-sortable">
    <ContextMenu>
      <ContextMenu.Trigger as="div" style={{ display: "contents" }}>
        <TooltipKeybind title={props.title} keybind="⌘1" placement="bottom" inactive={props.active}>
          <div class={`am-tab ${props.active ? "am-tab-active" : ""}`}>
            <span class="am-tab-label">{props.title}</span>
            <TooltipKeybind title="Close" keybind="⌘W" placement="bottom" class="am-tab-close-wrap">
              <IconButton icon="close-small" size="small" variant="ghost" label="Close" class="am-tab-close" />
            </TooltipKeybind>
          </div>
        </TooltipKeybind>
      </ContextMenu.Trigger>
    </ContextMenu>
  </div>
)

/** Mock review tab matching SortableReviewTab DOM (no ContextMenu wrapper). */
const MockReviewTab = (props: { active?: boolean }) => (
  <div class="am-tab-sortable">
    <TooltipKeybind title="Toggle review" keybind="⌘⇧R" placement="bottom" inactive={props.active}>
      <div class={`am-tab am-tab-review ${props.active ? "am-tab-active" : ""}`}>
        <span class="am-tab-icon">
          <Icon name="layers" size="small" />
        </span>
        <span class="am-tab-label">Review</span>
        <TooltipKeybind title="Close" keybind="⌘W" placement="bottom" class="am-tab-close-wrap">
          <IconButton icon="close-small" size="small" variant="ghost" label="Close" class="am-tab-close" />
        </TooltipKeybind>
      </div>
    </TooltipKeybind>
  </div>
)

const MockTabLeading = () => (
  <div class="am-tab-leading">
    <SidebarToggleButton collapsed={false} onClick={() => {}} />
  </div>
)

const MockTabAdd = () => (
  <div class="am-tab-add-wrap">
    <div class="am-tab-add-separator" />
    <div class="am-split-button am-tab-add-split">
      <TooltipKeybind title="New session" keybind="⌘T" placement="bottom">
        <IconButton icon="plus" size="small" variant="ghost" label="New session" class="am-tab-add" />
      </TooltipKeybind>
    </div>
  </div>
)

export const TabBarMultipleTabs: Story = {
  name: "TabBar — multiple tabs with active",
  render: () => (
    <StoryProviders noPadding>
      <div class="am-tab-bar">
        <MockTabLeading />
        <div class="am-tab-scroll-area">
          <div class="am-tab-list-wrap">
            <div class="am-tab-list" style={{ "--tab-count": "3" } as JSX.CSSProperties}>
              <MockTab title="Implement auth" active />
              <MockTab title="Fix button styles" />
              <MockTab title="Add unit tests" />
            </div>
          </div>
        </div>
        <MockTabAdd />
        <div class="am-tab-actions">
          <button class="am-diff-toggle-btn am-diff-toggle-has-changes">
            <Icon name="layers" size="small" />
            <span class="am-diff-toggle-stats">
              <span class="am-stat-files">4f</span>
              <span class="am-stat-additions">+32</span>
              <span class="am-stat-deletions">−8</span>
            </span>
          </button>
          <IconButton icon="console" size="small" variant="ghost" label="Terminal" />
        </div>
      </div>
    </StoryProviders>
  ),
}

export const TabBarWithReviewTab: Story = {
  name: "TabBar — with review tab",
  render: () => (
    <StoryProviders noPadding>
      <div class="am-tab-bar">
        <MockTabLeading />
        <div class="am-tab-scroll-area">
          <div class="am-tab-list-wrap">
            <div class="am-tab-list" style={{ "--tab-count": "2" } as JSX.CSSProperties}>
              <MockTab title="Implement auth" />
              <MockReviewTab active />
            </div>
          </div>
        </div>
        <MockTabAdd />
        <div class="am-tab-actions">
          <IconButton icon="expand" size="small" variant="ghost" label="Review" class="am-tab-diff-btn-active" />
          <IconButton icon="console" size="small" variant="ghost" label="Terminal" />
        </div>
      </div>
    </StoryProviders>
  ),
}

export const TabBarSingleTab: Story = {
  name: "TabBar — single active tab",
  render: () => (
    <StoryProviders noPadding>
      <div class="am-tab-bar">
        <MockTabLeading />
        <div class="am-tab-scroll-area">
          <div class="am-tab-list-wrap">
            <div class="am-tab-list" style={{ "--tab-count": "1" } as JSX.CSSProperties}>
              <MockTab title="PR #6966 worktree checkout" active />
            </div>
          </div>
        </div>
        <MockTabAdd />
        <div class="am-tab-actions">
          <button class="am-diff-toggle-btn am-diff-toggle-has-changes">
            <Icon name="layers" size="small" />
            <span class="am-diff-toggle-stats">
              <span class="am-stat-files">188f</span>
              <span class="am-stat-additions">+23625</span>
              <span class="am-stat-deletions">−359</span>
            </span>
          </button>
          <IconButton icon="console" size="small" variant="ghost" label="Terminal" />
        </div>
      </div>
    </StoryProviders>
  ),
}

const MockFullContextActions = () => (
  <div class="am-tab-actions">
    <TooltipKeybind title="Open this worktree in VS Code" keybind="" placement="bottom">
      <IconButton icon="folder" size="small" variant="ghost" aria-label="Open this worktree in VS Code" />
    </TooltipKeybind>
    <TooltipKeybind title="Apply selected worktree changes to local branch" keybind="" placement="bottom">
      <IconButton
        icon="check"
        size="small"
        variant="ghost"
        aria-label="Apply selected worktree changes to local branch"
      />
    </TooltipKeybind>
    <span class="am-split-button">
      <TooltipKeybind title="Run" keybind="⌘R" placement="bottom">
        <IconButton size="small" variant="ghost" icon="play" aria-label="Run" />
      </TooltipKeybind>
      <TooltipKeybind title="Run options" keybind="" placement="bottom">
        <button class="am-split-arrow" aria-label="Run options">
          <Icon name="chevron-down" size="small" />
        </button>
      </TooltipKeybind>
    </span>
    <TooltipKeybind title="Pull request" keybind="" placement="bottom">
      <IconButton icon="pull-request" size="small" variant="ghost" label="Pull request" />
    </TooltipKeybind>
    <TooltipKeybind title="Documents" keybind="" placement="bottom">
      <IconButton icon="book-open-check" size="small" variant="ghost" label="Documents" />
    </TooltipKeybind>
    <TooltipKeybind title="Subagents" keybind="" placement="bottom">
      <IconButton icon="task" size="small" variant="ghost" label="Subagents" />
    </TooltipKeybind>
    <TooltipKeybind title="Toggle diff" keybind="" placement="bottom">
      <button class="am-diff-toggle-btn am-diff-toggle-has-changes" title="Toggle diff">
        <Icon name="layers" size="small" />
        <span class="am-diff-toggle-stats">
          <span class="am-stat-files">4f</span>
          <span class="am-stat-additions">+32</span>
          <span class="am-stat-deletions">−8</span>
        </span>
      </button>
    </TooltipKeybind>
    <TooltipKeybind title="Toggle review" keybind="" placement="bottom">
      <IconButton icon="expand" size="small" variant="ghost" label="Toggle review" />
    </TooltipKeybind>
    <div class="am-split-button">
      <TooltipKeybind title="Open Terminal" keybind="" placement="bottom">
        <IconButton icon="console" size="small" variant="ghost" label="Open Terminal" />
      </TooltipKeybind>
      <button class="am-split-arrow" aria-label="Choose terminal destination">
        <Icon name="chevron-down" size="small" />
      </button>
    </div>
  </div>
)

export const TabBarFullContext: Story = {
  name: "TabBar — all optional context actions",
  render: () => (
    <StoryProviders noPadding>
      <div class="am-tab-bar">
        <MockTabLeading />
        <div class="am-tab-scroll-area">
          <div class="am-tab-list-wrap">
            <div class="am-tab-list" style={{ "--tab-count": "1" } as JSX.CSSProperties}>
              <MockTab title="Full context" active />
            </div>
          </div>
        </div>
        <MockTabAdd />
        <MockFullContextActions />
      </div>
    </StoryProviders>
  ),
}

// Side terminal panel inside the real inspector host chain, empty state —
// no live PTY, so the start affordance renders. The tab strip header keeps
// the .am-diff-header height so the a11y/screenshot baseline also guards
// the alignment against the diff panel chrome.
export const SideTerminalPanelEmpty: Story = {
  name: "Side terminal panel — empty",
  render: () => {
    const state = createTerminalState(() => LOCAL)
    return (
      <StoryProviders noPadding>
        <div class="am-detail-stack" style={{ height: "420px" }}>
          <div class="am-detail-content am-detail-split">
            <div class="am-main-pane" style={{ padding: "24px", color: "var(--text-weak)" }}>
              Agent session stays visible beside the terminal.
            </div>
            <div class="am-diff-resize" style={{ width: "320px" }}>
              <div class="am-diff-panel-wrapper">
                <SideTerminalPanel
                  state={state}
                  contextKey={() => LOCAL}
                  visible={() => true}
                  nextKeybind="⌘⇧]"
                  closeKeybind="⌘W"
                  onFocusPrompt={() => undefined}
                  onSelect={() => undefined}
                  onClose={() => undefined}
                  onCloseOthers={() => undefined}
                  onStart={() => undefined}
                  onStop={() => undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </StoryProviders>
    )
  },
}

// Tab strip with several side terminals: the active one shows the X close
// button, the others reveal it on hover. Terminals point at a dead port —
// xterm renders its connection-error notice inside the panel, which keeps
// the story self-contained without a live PTY.
export const SideTerminalPanelTabs: Story = {
  name: "Side terminal panel — tabs",
  render: () => {
    const state = createTerminalState(() => LOCAL)
    const font = { fontFamily: "monospace", fontSize: 12 }
    state.add(null, { id: "terminal:one", title: "Terminal 1", wsUrl: "ws://127.0.0.1:1/a", font, placement: "side" })
    state.add(null, { id: "terminal:two", title: "Terminal 2", wsUrl: "ws://127.0.0.1:1/b", font, placement: "side" })
    state.add(null, { id: "terminal:three", title: "Terminal 3", wsUrl: "ws://127.0.0.1:1/c", font, placement: "side" })
    state.setSideActive(LOCAL, "terminal:two")
    state.setTitle("terminal:two", "npm run dev")
    return (
      <StoryProviders noPadding>
        <div class="am-detail-stack" style={{ height: "420px" }}>
          <div class="am-detail-content am-detail-split">
            <div class="am-main-pane" style={{ padding: "24px", color: "var(--text-weak)" }}>
              Agent session stays visible beside the terminal.
            </div>
            <div class="am-diff-resize" style={{ width: "360px" }}>
              <div class="am-diff-panel-wrapper">
                <SideTerminalPanel
                  state={state}
                  contextKey={() => LOCAL}
                  visible={() => true}
                  nextKeybind="⌘⇧]"
                  closeKeybind="⌘W"
                  onFocusPrompt={() => undefined}
                  onSelect={(id) => state.setSideActive(LOCAL, id)}
                  onClose={() => undefined}
                  onCloseOthers={() => undefined}
                  onStart={() => undefined}
                  onStop={() => undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// NewWorktreeDialog — inline selector popovers must escape the dialog scroll
// containers. Regression: the reasoning-variant and mode pickers were clipped
// by .am-nv-dialog-content (overflow-y: auto) and .am-prompt-input-container
// (overflow: hidden) because the overflow escape hatch only covered the model
// picker. This fixture reproduces the real clipping chain (same CSS classes +
// the real inline ThinkingSelectorBase with portal={false}) so a screenshot
// baseline catches any future regression. Rendered inline (no dialog portal)
// because the visual-regression harness screenshots #storybook-root.
// ---------------------------------------------------------------------------

const VariantPickerOpener = () => {
  let frame = 0
  let attempts = 0
  const open = () => {
    if (document.querySelector("[data-component='popover-content']")) return
    if (attempts++ >= 120) return
    window.dispatchEvent(new CustomEvent("openVariantPicker"))
    frame = requestAnimationFrame(open)
  }
  onMount(() => {
    frame = requestAnimationFrame(open)
  })
  onCleanup(() => cancelAnimationFrame(frame))
  return null
}

export const NewWorktreeVariantDropdown1280: Story = {
  name: "NewWorktreeDialog — variant dropdown open",
  parameters: { layout: "fullscreen" },
  render: () => (
    <StoryProviders noPadding>
      {/* Filler pushes the prompt container to the bottom of the dialog content.
          The variant popover opens upward from the trigger, extending above the
          container's top edge. Without the overflow escape fix, .am-prompt-input-container
          (overflow: hidden + position: relative) clips the top of the popover. */}
      <div style={{ height: "100vh", display: "flex", "flex-direction": "column" }}>
        <div class="am-nv-dialog">
          <div class="am-nv-dialog-content">
            <div style={{ height: "500px", "flex-shrink": 0 }} />
            <div
              class="prompt-input-container am-prompt-input-container"
              style={{ position: "relative", "flex-shrink": 0 }}
            >
              <div class="prompt-input-hint">
                <div class="prompt-input-hint-selectors">
                  <ThinkingSelectorBase
                    variants={["low", "medium", "high"]}
                    value="low"
                    onSelect={() => {}}
                    portal={false}
                    deferDismiss
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <VariantPickerOpener />
    </StoryProviders>
  ),
}

const projectPickerProjects: AgentProjectSnapshot[] = [
  {
    id: "project-main",
    root: "/workspace/kilocode",
    label: "kilocode",
    pinned: true,
    active: true,
    expanded: true,
    initialized: true,
    missing: false,
  },
  {
    id: "project-cloud",
    root: "/workspace/cloud",
    label: "cloud",
    pinned: false,
    active: false,
    expanded: false,
    initialized: true,
    missing: false,
  },
]

export const NewWorktreeProjectDropdown: Story = {
  name: "NewWorktreeDialog — project dropdown open",
  parameters: { layout: "fullscreen" },
  render: () => (
    <StoryProviders noPadding>
      <div style={{ height: "100vh", display: "flex", "flex-direction": "column" }}>
        <div data-component="dialog" data-fit="true">
          <div data-slot="dialog-container">
            <div data-slot="dialog-content">
              <div data-slot="dialog-header">
                <div data-slot="dialog-title">New Worktree</div>
              </div>
              <div data-slot="dialog-body">
                <div class="am-tab-switcher">
                  <button class="am-tab-switcher-pill am-tab-switcher-pill-active" type="button">
                    New
                  </button>
                  <button class="am-tab-switcher-pill" type="button">
                    Import
                  </button>
                  <div class="am-nv-project-inline">
                    <div class="am-selector-wrapper">
                      <DeferredPopover
                        open
                        onOpenChange={() => undefined}
                        placement="bottom-start"
                        flip={false}
                        sameWidth
                        portal={false}
                        deferDismiss
                        class="am-dropdown"
                        trigger={
                          <button class="am-selector-trigger" type="button" aria-label="Select project">
                            <span class="am-selector-left">
                              <Icon name="folder" size="small" />
                              <span class="am-selector-value">kilocode</span>
                            </span>
                            <span class="am-selector-right">
                              <Icon name="selector" size="small" />
                            </span>
                          </button>
                        }
                      >
                        <ProjectSelect
                          projects={projectPickerProjects}
                          selected="project-main"
                          onSelect={() => undefined}
                          labels={{ missing: "Repository not found" }}
                        />
                      </DeferredPopover>
                    </div>
                  </div>
                </div>
                <div class="am-nv-dialog" style={{ "max-height": "520px" }}>
                  <div class="am-nv-dialog-content">
                    <div style={{ height: "420px", "flex-shrink": 0 }} />
                    <div class="am-nv-version-bar">
                      <span class="am-nv-config-label">VERSIONS</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StoryProviders>
  ),
}

const searchSection = { id: "polish", name: "Polish", color: "Blue", order: 0, collapsed: false }
const slackedSection = { id: "slacked", name: "SLACKED", color: "Yellow", order: 1, collapsed: false }
const sidebarSearchItems: SidebarSearchItem[] = [
  {
    key: "session:session-build",
    kind: "session",
    group: "sessions",
    title: "Build grouped worktree search",
    meta: ["Polish", "Agent Manager search", "feat/sidebar-search"],
    search: "Build grouped worktree search Agent Manager search feat/sidebar-search Polish",
    sessionId: "session-build",
    location: "worktree",
    worktreeId: "wt-search",
    updatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    state: "busy",
    visible: true,
    section: searchSection,
  },
  {
    key: "session:session-local",
    kind: "session",
    group: "sessions",
    title: "Investigate local indexing",
    meta: ["local"],
    search: "Investigate local indexing local",
    sessionId: "session-local",
    location: "local",
    updatedAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    state: "idle",
    visible: true,
  },
  {
    key: "session:session-render",
    kind: "session",
    group: "sessions",
    title: "Render images in diff viewer",
    meta: ["SLACKED", "images diff viewer", "utopian-approval"],
    search: "Render images in diff viewer SLACKED images diff viewer utopian-approval",
    sessionId: "session-render",
    location: "worktree",
    worktreeId: "wt-render",
    updatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    state: "idle",
    visible: true,
    section: slackedSection,
  },
  {
    key: "local",
    kind: "local",
    group: "contexts",
    title: "local",
    meta: ["main"],
    search: "local main",
    updatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    state: "idle",
    visible: true,
    count: 2,
  },
  {
    key: "worktree:wt-search",
    kind: "worktree",
    group: "contexts",
    title: "Agent Manager search",
    meta: ["Polish", "feat/sidebar-search"],
    search: "Agent Manager search Polish feat/sidebar-search",
    worktreeId: "wt-search",
    updatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    state: "busy",
    visible: true,
    section: searchSection,
    count: 2,
  },
]

export const SidebarSearchOpen: Story = {
  name: "Sidebar search — worktrees and sessions",
  render: () => {
    const [selected, setSelected] = createSignal("worktree:wt-search")
    let prompt!: HTMLTextAreaElement
    const refocus = () => requestAnimationFrame(() => prompt.focus())
    onMount(() => {
      window.addEventListener("focusPrompt", refocus)
      onCleanup(() => window.removeEventListener("focusPrompt", refocus))
    })
    return (
      <StoryProviders noPadding>
        <div style={{ "min-height": "430px", padding: "16px", background: "var(--surface-base)" }}>
          <div class="am-section-header">
            <span class="am-section-label">WORKTREES</span>
            <div class="am-section-actions">
              <SidebarSearchMenu
                items={() => sidebarSearchItems}
                keybind="⌘F"
                current={() => sidebarSearchItems.find((item) => item.key === selected())}
                labels={{
                  search: "Search worktrees and sessions",
                  scope: "Searches the local workspace, local sessions, worktrees, and their sessions",
                  contexts: "LOCAL & WORKTREES",
                  sessions: "SESSIONS",
                  state: (value) => value,
                }}
                onSelect={(item) => setSelected(item.key)}
                defaultOpen
                portal={false}
              />
            </div>
          </div>
          <output class="sr-only" data-slot="sidebar-search-selection">
            {selected()}
          </output>
          <textarea ref={prompt} class="sr-only" aria-label="Story prompt" />
        </div>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// Multi-project sidebar
// ---------------------------------------------------------------------------

import { ProjectList } from "../../agent-manager/ProjectList"
import type { AgentManagerStateMessage, LocalGitStats, ProjectSessionInfo } from "../types/messages"

const projectA: AgentProjectSnapshot = {
  id: "prj-aaaa1111aaaa",
  root: "/repos/kilocode",
  label: "kilocode",
  pinned: true,
  active: true,
  expanded: true,
  initialized: true,
  missing: false,
}
const projectB: AgentProjectSnapshot = {
  id: "prj-bbbb2222bbbb",
  root: "/repos/kilo-gateway",
  label: "kilo-gateway",
  pinned: false,
  active: false,
  expanded: true,
  initialized: true,
  missing: false,
}

const wt = (id: string, branch: string, label?: string, opts: Partial<WorktreeState> = {}): WorktreeState => ({
  id,
  branch,
  path: `/repos/x/.kilo/worktrees/${id}`,
  parentBranch: "main",
  createdAt: "2026-07-20T10:00:00Z",
  label,
  ...opts,
})

const projectState = (
  projectId: string,
  worktrees: WorktreeState[],
  sessions: { id: string; worktreeId: string | null }[],
  sections: NonNullable<AgentManagerStateMessage["sections"]> = [],
  baseBranch = "main",
  worktreeOrder?: string[],
): AgentManagerStateMessage => ({
  type: "agentManager.state",
  projectId,
  worktrees,
  sessions: sessions.map((s) => ({ id: s.id, worktreeId: s.worktreeId, createdAt: "2026-07-20T10:00:00Z" })),
  sections,
  worktreeOrder: worktreeOrder ?? [
    ...worktrees.filter((item) => !item.sectionId).map((item) => item.id),
    ...sections.map((item) => item.id),
    ...worktrees.filter((item) => item.sectionId).map((item) => item.id),
  ],
  staleWorktreeIds: [],
  isGitRepo: true,
  defaultBaseBranch: baseBranch,
  sessionsCollapsed: false,
})

const projectSession = (
  id: string,
  worktreeId: string | null,
  title: string,
  updatedAt: string,
): ProjectSessionInfo => ({
  id,
  worktreeId,
  parentID: null,
  title,
  createdAt: "2026-07-19T09:00:00Z",
  updatedAt,
})

const storyStats = (worktreeId: string, additions: number, deletions: number, ahead = 0): WorktreeGitStats => ({
  worktreeId,
  files: 3,
  additions,
  deletions,
  ahead,
  behind: 0,
})

const storyLocal = (branch: string, additions: number, deletions: number, ahead = 0, behind = 0): LocalGitStats => ({
  branch,
  files: 2,
  additions,
  deletions,
  ahead,
  behind,
})

export const MultiProjectSidebar: Story = {
  name: "Project List — two expanded projects with restored controls",
  render: () => {
    return (
      <StoryProviders noPadding>
        <div style={{ display: "flex", "flex-direction": "column", "max-height": "720px", overflow: "auto" }}>
          <ProjectList
            mode={createModeRouter()}
            projects={[projectA, projectB]}
            states={{
              [projectA.id]: projectState(
                projectA.id,
                [
                  wt("wt-a1", "feature/project-list", "Project list UI", { sectionId: "sec-a1" }),
                  wt("wt-a2", "fix/session-routing"),
                  wt("wt-a3", "feat/project-list-v2", undefined, { groupId: "grp-a1" }),
                  wt("wt-a4", "feat/project-list-v3", undefined, { groupId: "grp-a1" }),
                ],
                [
                  { id: "ses-a1", worktreeId: null },
                  { id: "ses-a2", worktreeId: "wt-a1" },
                ],
                [{ id: "sec-a1", name: "Agent Manager", color: "Blue", order: 0, collapsed: false }],
                "main",
                ["wt-a2", "sec-a1", "wt-a1", "wt-a3", "wt-a4"],
              ),
              [projectB.id]: projectState(
                projectB.id,
                [
                  wt("wt-b1", "feat/gateway-routing", "Gateway routing", { sectionId: "sec-b1" }),
                  wt("wt-b2", "fix/api"),
                ],
                [{ id: "ses-b1", worktreeId: null }],
                [{ id: "sec-b1", name: "In progress", color: null, order: 0, collapsed: false }],
                "master",
                ["wt-b2", "sec-b1", "wt-b1"],
              ),
            }}
            stats={{
              [projectA.id]: { "wt-a1": storyStats("wt-a1", 342, 87, 2), "wt-a2": storyStats("wt-a2", 18, 4) },
              [projectB.id]: { "wt-b1": storyStats("wt-b1", 96, 12, 1) },
            }}
            local={{
              [projectA.id]: storyLocal("main", 124, 33, 1),
              [projectB.id]: storyLocal("master", 0, 0, 0, 2),
            }}
            prs={{ [projectA.id]: {}, [projectB.id]: {} }}
            busy={() => false}
            blocked={() => false}
            sessions={{
              [projectA.id]: [
                projectSession("ses-a1", null, "Refine project accordion layout", "2026-07-24T08:30:00Z"),
                projectSession("ses-a2", "wt-a1", "Add per-project actions", "2026-07-23T16:10:00Z"),
              ],
              [projectB.id]: [projectSession("ses-b1", null, "Route stats per project", "2026-07-24T07:45:00Z")],
            }}
            selectedProject={projectA.id}
            selection="local"
            activityFor={() => "idle"}
            sessionActivity={() => "idle"}
            bindings={{ search: "⌘F", showShortcuts: "⌘⇧/", newWorktree: "⌘N", quickWorktree: "⌘⇧N" }}
            t={t}
            onSearchRef={() => {}}
            onShortcuts={() => {}}
            onHistory={() => {}}
          />
        </div>
      </StoryProviders>
    )
  },
}

export const MultiProjectSidebar200: Story = {
  ...MultiProjectSidebar,
  name: "Project List - minimum sidebar width",
  parameters: { layout: "fullscreen" },
}

// ---------------------------------------------------------------------------
// PR panel — review comments
// ---------------------------------------------------------------------------

const prComments: NonNullable<PRStatus["comments"]> = {
  total: 4,
  unresolved: 2,
  comments: [
    {
      id: "PRRC_1",
      threadId: "PRRT_1",
      author: "octocat",
      body: "This throws when `gh` is missing. Can we guard it and fall back to the cached status?",
      file: "packages/kilo-vscode/src/agent-manager/gh.ts",
      line: 42,
      url: "https://github.com/org/repo/pull/8594#discussion_r1",
      resolved: false,
      outdated: false,
      createdAt: Date.now() - 5 * 60 * 1000,
      diffHunk:
        '@@ -39,7 +39,7 @@ export function execGhRead(args: string[]) {\n-  return execWithShellEnv("gh", args, options)\n+  return execWithShellEnv("gh", args, { ...options, env: env(options) })',
      side: "additions",
      preview: {
        patch:
          '@@ -40,6 +40,6 @@\n   const options = { timeout: 5000 }\n   const result = await\n-    execWithShellEnv("gh", args, options)\n+    execWithShellEnv("gh", args, { ...options, env: env(options) })\n   return result\n }\n ',
        line: 42,
        side: "additions",
        base: "b".repeat(40),
        head: "a".repeat(40),
        top: true,
        bottom: true,
      },
      replies: [{ author: "hubot", body: "Agreed. A guard plus a log line is enough here." }],
    },
    {
      id: "PRRC_2",
      threadId: "PRRT_2",
      author: "hubot",
      body: "The timeout should be a constant so the poller and the mutation cannot drift apart.",
      file: "packages/kilo-vscode/src/agent-manager/pr/PRActions.ts",
      line: 8,
      url: "https://github.com/org/repo/pull/8594#discussion_r2",
      resolved: false,
      outdated: true,
    },
    {
      id: "PRRC_3",
      threadId: "PRRT_3",
      author: "octocat",
      body: "nit: rename this variable to `threads`.\n\nIt reads better next to the loop below.",
      file: "packages/kilo-vscode/src/agent-manager/pr/am-pr-utils.ts",
      line: 71,
      url: "https://github.com/org/repo/pull/8594#discussion_r3",
      resolved: true,
      outdated: false,
    },
    {
      id: "PRRC_4",
      threadId: "PRRT_4",
      author: "hubot",
      body: "Good catch, fixed in a9f21c3.",
      file: "packages/kilo-vscode/webview-ui/agent-manager/pr/PRComments.tsx",
      line: 118,
      url: "https://github.com/org/repo/pull/8594#discussion_r4",
      resolved: true,
      outdated: false,
    },
  ],
}

export const PRPanelComments: Story = {
  name: "PR panel — review comments",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ background: "var(--vscode-editor-background)" }}>
        <PRComments
          comments={prComments}
          worktreeId="wt-a1"
          onOpenFile={() => {}}
          onOpenDiff={() => {}}
          onOpenUrl={() => {}}
        />
      </div>
    </StoryProviders>
  ),
}

export const PRPanelComments200: Story = {
  name: "PR panel — review comments (narrow)",
  render: () => (
    <StoryProviders noPadding>
      <div style={{ background: "var(--vscode-editor-background)" }}>
        <PRComments
          comments={prComments}
          worktreeId="wt-a1"
          onOpenFile={() => {}}
          onOpenDiff={() => {}}
          onOpenUrl={() => {}}
        />
      </div>
    </StoryProviders>
  ),
}

const remoteThreads: PRComment[] = [
  {
    id: "remote-addition",
    threadId: "thread-addition",
    author: "kilo-code-bot",
    body: "Keep this value stable while the request is in progress.\n\nThe caller uses `target` to restore the previous selection.",
    file: tail.file,
    line: 1,
    side: "additions",
    resolved: false,
    outdated: false,
    diffHunk: "@@ -1 +1 @@\n-const target = 'before'\n+const target = 'after'",
    replies: [{ author: "hubot", body: "Agreed. The loading state should not clear the selection." }],
  },
  {
    id: "remote-deletion",
    threadId: "thread-deletion",
    author: "hubot",
    body: "Does the fallback still use the previous value?",
    file: tail.file,
    line: 1,
    side: "deletions",
    resolved: true,
    outdated: false,
    diffHunk: "@@ -1 +1 @@\n-const target = 'before'",
  },
  {
    id: "remote-outdated",
    threadId: "thread-outdated",
    author: "octocat",
    body: "This file has since been removed. Keep the original context available for the discussion.",
    file: "src/removed.ts",
    line: 2,
    side: "additions",
    resolved: false,
    outdated: true,
    diffHunk: "@@ -1,2 +1,2 @@\n export const state = {\n+  ready: true",
  },
]

function RemoteReviewStory(props: { full?: boolean }) {
  const Panel = props.full ? FullScreenDiffView : DiffPanel
  const [style, setStyle] = createSignal<"unified" | "split">("unified")
  const [comments, setComments] = createSignal<ReviewComment[]>([
    {
      id: "local-review",
      file: tail.file,
      side: "additions",
      line: 1,
      comment: "Keep this local note separate from the PR discussion.",
      selectedText: "const target = 'after'",
    },
  ])
  return (
    <StoryProviders noPadding>
      <div style={{ height: "700px", display: "flex", "flex-direction": "column" }}>
        <Panel
          diffs={[tail]}
          loading={false}
          sessionKey={props.full ? "remote-review-full" : "remote-review-inline"}
          diffStyle={style()}
          onDiffStyleChange={setStyle}
          remoteComments={remoteThreads}
          comments={comments()}
          onCommentsChange={setComments}
          onClose={() => {}}
          onOpenFile={() => {}}
        />
      </div>
    </StoryProviders>
  )
}

export const DiffPanelWithPRThreads: Story = {
  name: "DiffPanel - remote PR threads",
  render: () => <RemoteReviewStory />,
}

export const FullScreenDiffWithPRThreads: Story = {
  name: "FullScreenDiffView - remote PR threads",
  render: () => <RemoteReviewStory full />,
}
