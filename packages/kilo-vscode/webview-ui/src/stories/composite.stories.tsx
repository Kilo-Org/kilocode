/** @jsxImportSource solid-js */
/**
 * Composite visual regression stories for the kilo-vscode webview.
 *
 * These test the *composed* UI — how kilo-ui components look together
 * in the extension webview context with extension-specific styling,
 * inline permission prompts, and tool card overrides.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import type { AssistantMessage as SDKAssistantMessage, TextPart, ToolPart } from "@kilocode/sdk/v2"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { AssistantMessage } from "../components/chat/AssistantMessage"
import { VscodeSessionTurn } from "../components/chat/VscodeSessionTurn"
import { ChatView } from "../components/chat/ChatView"
import { Part } from "@kilocode/kilo-ui/message-part"
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
import { SessionContext } from "../context/session"
import { ServerContext } from "../context/server"
import type { PermissionRequest, QuestionRequest } from "../types/messages"

// Register VS Code tool overrides (bash expanded by default, etc.)
registerVscodeToolOverrides()

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const SESSION_ID = "story-session-001"
const ASST_MSG_ID = "asst-msg-001"
const now = Date.now()

const baseAssistantMessage: SDKAssistantMessage = {
  id: ASST_MSG_ID,
  sessionID: SESSION_ID,
  role: "assistant",
  parentID: "user-msg-001",
  time: { created: now - 9000, completed: now - 5000 },
  modelID: "claude-sonnet-4-20250514",
  providerID: "anthropic",
  mode: "default",
  agent: "default",
  path: { cwd: "/project", root: "/project" },
  cost: 0.0023,
  tokens: { total: 512, input: 256, output: 256, reasoning: 0, cache: { read: 0, write: 0 } },
}

// ---------------------------------------------------------------------------
// Tool parts
// ---------------------------------------------------------------------------

const globPending = {
  id: "part-glob-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-glob-001",
  tool: "glob",
  state: {
    status: "pending",
    input: { pattern: "**/*.md", path: "." },
    metadata: {},
    time: { start: now - 3000 },
  },
}

const readCompleted: ToolPart = {
  id: "part-read-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-read-001",
  tool: "read",
  state: {
    status: "completed",
    input: { filePath: "src/main.tsx" },
    output: 'import { render } from "solid-js/web"\nrender(() => <App />, document.getElementById("root")!)',
    title: "Read file",
    metadata: {},
    time: { start: now - 8000, end: now - 7500 },
  },
}

const grepCompleted: ToolPart = {
  id: "part-grep-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-grep-001",
  tool: "grep",
  state: {
    status: "completed",
    input: { pattern: "TODO", path: "src/" },
    output: "src/main.tsx:12: // TODO: add error boundary\nsrc/utils.ts:5: // TODO: refactor",
    title: "Search",
    metadata: {},
    time: { start: now - 7000, end: now - 6500 },
  },
}

const globCompleted: ToolPart = {
  id: "part-glob-002",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-glob-002",
  tool: "glob",
  state: {
    status: "completed",
    input: { pattern: "src/**/*.ts", path: "." },
    output: "src/main.ts\nsrc/utils.ts\nsrc/types.ts",
    title: "Found 3 files",
    metadata: {},
    time: { start: now - 6000, end: now - 5800 },
  },
}

const lsCompleted: ToolPart = {
  id: "part-ls-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-ls-001",
  tool: "ls",
  state: {
    status: "completed",
    input: { path: "." },
    output: "src/\npackage.json\ntsconfig.json\nREADME.md",
    title: "List directory",
    metadata: {},
    time: { start: now - 5500, end: now - 5400 },
  },
}

const bashPending = {
  id: "part-bash-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-bash-001",
  tool: "bash",
  state: {
    status: "pending",
    input: { description: "Run tests", command: "bun test" },
    metadata: {},
    time: { start: now - 2000 },
  },
}

const textPart: TextPart = {
  id: "part-text-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "text",
  text: "I found the relevant files and will now update them.",
}

// ---------------------------------------------------------------------------
// Permission fixtures
// ---------------------------------------------------------------------------

const globPermission: PermissionRequest = {
  id: "perm-glob-001",
  sessionID: SESSION_ID,
  toolName: "glob",
  patterns: ["**/*.md"],
  always: ["*"],
  args: { pattern: "**/*.md" },
  tool: { messageID: ASST_MSG_ID, callID: "call-glob-001" },
}

const bashPermission: PermissionRequest = {
  id: "perm-bash-001",
  sessionID: SESSION_ID,
  toolName: "bash",
  patterns: ["bun test"],
  always: ["bun *"],
  args: { command: "bun test", rules: ["bun *", "bun test"] },
  tool: { messageID: ASST_MSG_ID, callID: "call-bash-001" },
}

const dockPermission: PermissionRequest = {
  id: "perm-dock-001",
  sessionID: SESSION_ID,
  toolName: "write",
  patterns: ["src/main.tsx", "src/utils.ts"],
  always: ["*"],
  args: {},
  // No `tool` field — this is a non-tool (dock) permission
}

// ---------------------------------------------------------------------------
// Question fixtures
// ---------------------------------------------------------------------------

const questionRequest: QuestionRequest = {
  id: "question-001",
  sessionID: SESSION_ID,
  questions: [
    {
      question: "Which testing framework should I use for this project?",
      header: "Choose a framework",
      options: [
        { label: "Vitest", description: "Fast, Vite-native unit testing" },
        { label: "Jest", description: "Widely adopted, rich ecosystem" },
        { label: "Playwright", description: "End-to-end browser testing" },
        { label: "Bun test", description: "Built-in, zero config" },
      ],
    },
  ],
  tool: { messageID: ASST_MSG_ID, callID: "call-question-001" },
}

const questionToolPart: ToolPart = {
  id: "part-question-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-question-001",
  tool: "question",
  state: {
    status: "running",
    input: { question: "Which testing framework?", options: [] },
    title: "Asking question",
    metadata: {},
    time: { start: now - 1000 },
  },
}

const questionDismissedPart: ToolPart = {
  id: "part-question-dismissed-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-question-dismissed-001",
  tool: "question",
  state: {
    status: "error",
    input: { question: "Which testing framework?", options: [] },
    error: "Error: User dismissed this question",
    metadata: {},
    time: { start: now - 2000, end: now - 1500 },
  },
}

// ---------------------------------------------------------------------------
// Todo tool parts
// ---------------------------------------------------------------------------

const todoWritePending: ToolPart = {
  id: "part-todo-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-todo-001",
  tool: "todowrite",
  state: {
    status: "pending",
    input: {
      todos: [
        { id: "1", content: "Create a haiku about Jan", status: "pending" },
        { id: "2", content: "Create a poem about Henk", status: "pending" },
      ],
    },
  } as any,
}

const todoWriteCompleted: ToolPart = {
  id: "part-todo-002",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-todo-002",
  tool: "todowrite",
  state: {
    status: "completed",
    input: {
      todos: [
        { id: "1", content: "Create a haiku about Jan", status: "completed" },
        { id: "2", content: "Create a poem about Henk", status: "in_progress" },
      ],
    },
    output: "Updated 2 todos",
    title: "Updated to-dos",
    metadata: {
      todos: [
        { id: "1", content: "Create a haiku about Jan", status: "completed" },
        { id: "2", content: "Create a poem about Henk", status: "in_progress" },
      ],
    },
    time: { start: now - 3000, end: now - 2800 },
  },
}

const docsTodos = [
  {
    id: "1",
    content: "Project setup and core architecture (package.json, tsconfig, documentation, type definitions)",
    status: "completed",
  },
  {
    id: "2",
    content: "Configuration system (scraper config, targets.json, validation utilities)",
    status: "completed",
  },
  {
    id: "3",
    content: "Core scraping engine (browser manager, orchestrator, selector engine, content extractor)",
    status: "completed",
  },
  {
    id: "4",
    content: "Utility modules (DOM utils, retry logic, URL handling, validation)",
    status: "completed",
  },
  { id: "5", content: "CLI interface implementation", status: "in_progress" },
  { id: "6", content: "Storage layer implementation (database and file storage)", status: "pending" },
  { id: "7", content: "Chart extractors for specific chart types", status: "pending" },
  { id: "8", content: "Logging and error handling systems", status: "pending" },
  { id: "9", content: "Test suites (unit and integration tests)", status: "pending" },
  { id: "10", content: "Main entry point and final integration", status: "pending" },
]

const todoWriteDocsOverview: ToolPart = {
  id: "part-todo-docs-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-todo-docs-001",
  tool: "todowrite",
  state: {
    status: "completed",
    input: { todos: docsTodos },
    output: "Updated 10 todos",
    title: "Todo List Updated",
    metadata: { todos: docsTodos },
    time: { start: now - 3000, end: now - 2800 },
  },
}

const compactTodos = docsTodos.map((todo, index) =>
  index < 5 ? { ...todo, status: "completed" } : { ...todo, status: index === 5 ? "pending" : todo.status },
)
const compactViewTodos = compactTodos.slice(3, 6).map((todo, index) => ({ ...todo, changed: index === 1 }))

const todoWriteCompactUpdate: ToolPart = {
  id: "part-todo-compact-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-todo-compact-001",
  tool: "todowrite",
  state: {
    status: "completed",
    input: { todos: compactTodos },
    output: "Updated 10 todos",
    title: "Todo List Updated",
    metadata: {
      todos: compactTodos,
      view: {
        mode: "compact",
        todos: compactViewTodos,
        hiddenBefore: 3,
        hiddenAfter: 4,
        changed: 1,
      },
    },
    time: { start: now - 3000, end: now - 2800 },
  },
}

const todoWritePermission: PermissionRequest = {
  id: "perm-todo-001",
  sessionID: SESSION_ID,
  toolName: "todowrite",
  patterns: ["*"],
  always: ["*"],
  args: {},
  tool: { messageID: ASST_MSG_ID, callID: "call-todo-001" },
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function dataWith(parts: any[], permissions?: PermissionRequest[]) {
  return {
    ...defaultMockData,
    message: {
      [SESSION_ID]: [baseAssistantMessage],
    },
    part: {
      [ASST_MSG_ID]: parts,
    },
    permission: permissions ? { [SESSION_ID]: permissions } : {},
  }
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "Composite/Webview",
  parameters: { layout: "padded" },
}
export default meta

type Story = StoryObj

// ---------------------------------------------------------------------------
// 1. Permission dock — glob (above chatbox)
// ---------------------------------------------------------------------------

export const GlobWithPermission: Story = {
  name: "Permission Dock — glob above chatbox",
  render: () => {
    const perms = [globPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "300px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 2. Permission dock — bash (above chatbox)
// ---------------------------------------------------------------------------

export const BashWithPermission: Story = {
  name: "Permission Dock — bash above chatbox",
  render: () => {
    const perms = [bashPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "300px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 3. Permission dock — write with file patterns (above chatbox)
// ---------------------------------------------------------------------------

export const PermissionDockWrite: Story = {
  name: "Permission Dock — write with patterns",
  render: () => {
    const perms = [dockPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "350px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 3b. Permission dock — todowrite (above chatbox)
// ---------------------------------------------------------------------------

export const PermissionDockTodo: Story = {
  name: "Permission Dock — todowrite above chatbox",
  render: () => {
    const perms = [todoWritePermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "300px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 3c. Question dock above chatbox
// ---------------------------------------------------------------------------

export const QuestionAboveChatbox: Story = {
  name: "Question Dock — above chatbox",
  render: () => {
    const qs = [questionRequest]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", questions: qs }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders questions={qs} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "500px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 4. Tool cards — read, glob, grep, ls
// ---------------------------------------------------------------------------

export const ToolCards: Story = {
  name: "Tool Cards",
  render: () => {
    const data = dataWith([readCompleted, globCompleted, grepCompleted, lsCompleted])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 5. Chat idle — prompt input placeholder
// ---------------------------------------------------------------------------

export const ChatIdle: Story = {
  name: "Chat Idle",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle">
      <div class="chat-view" style={{ width: "380px" }}>
        <div class="chat-input">
          <div
            style={{
              padding: "8px 12px",
              border: "1px solid var(--border-base)",
              "border-radius": "8px",
              color: "var(--text-dimmed)",
              "font-size": "13px",
              background: "var(--background-input)",
            }}
          >
            Ask anything… (⌘ Enter)
          </div>
        </div>
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// 6. Chat busy — working indicator, no prompt
// ---------------------------------------------------------------------------

export const ChatBusy: Story = {
  name: "Chat Busy",
  render: () => {
    const data = dataWith([textPart])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID} status="busy">
        <div class="chat-view" style={{ width: "380px" }}>
          <div class="vscode-session-turn-assistant">
            <AssistantMessage message={baseAssistantMessage} />
          </div>
          <div
            style={{
              padding: "8px 12px",
              display: "flex",
              "align-items": "center",
              gap: "8px",
              color: "var(--text-dimmed)",
              "font-size": "13px",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                "border-radius": "50%",
                background: "var(--accent-base)",
                animation: "pulse 1.5s infinite",
              }}
            />
            Thinking…
          </div>
        </div>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 7. Multiple tool calls in one assistant message
// ---------------------------------------------------------------------------

export const MultipleToolCalls: Story = {
  name: "Multiple Tool Calls",
  render: () => {
    const data = dataWith([readCompleted, globCompleted, textPart])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 9. Dismissed question (right-aligned "Questions dismissed" text)
// ---------------------------------------------------------------------------

export const QuestionDismissed: Story = {
  name: "Question Dismissed",
  render: () => {
    const data = dataWith([textPart, questionDismissedPart])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 10. TodoWrite with permission in dock (pending — permission shown above chatbox)
// ---------------------------------------------------------------------------

export const TodoWriteWithPermission: Story = {
  name: "TodoWrite + Permission in Dock",
  render: () => {
    const perms = [todoWritePermission]
    const data = dataWith([todoWritePending], perms)
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders data={data} permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "350px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 11. TodoWrite completed (inline in chat after permission granted)
// ---------------------------------------------------------------------------

export const TodoWriteCompleted: Story = {
  name: "TodoWrite — Completed Inline",
  render: () => {
    const data = dataWith([todoWriteCompleted])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

export const TodoWriteDocsOverview: Story = {
  name: "TodoWrite — docs overview",
  render: () => {
    const data = dataWith([todoWriteDocsOverview])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

export const TodoWriteCompactUpdate: Story = {
  name: "TodoWrite - Compact update",
  render: () => {
    const data = dataWith([todoWriteCompactUpdate])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 12. Permission dock — edit tool with file patterns
// ---------------------------------------------------------------------------

const editPermission: PermissionRequest = {
  id: "perm-edit-001",
  sessionID: SESSION_ID,
  toolName: "edit",
  patterns: ["src/components/App.tsx", "src/utils/helpers.ts"],
  always: ["*"],
  args: {
    filediff: {
      file: "src/components/App.tsx",
      patch:
        '===================================================================\n--- src/components/App.tsx\n+++ src/components/App.tsx\n@@ -1,3 +1,4 @@\n import { Button } from "@kilocode/kilo-ui/button"\n+import { Card } from "@kilocode/kilo-ui/card"\n \n export function App() {\n',
      additions: 1,
      deletions: 0,
    },
  },
  tool: { messageID: ASST_MSG_ID, callID: "call-edit-001" },
}

const applyPatchPermission: PermissionRequest = {
  id: "perm-patch-001",
  sessionID: SESSION_ID,
  toolName: "edit",
  patterns: ["src/components/App.tsx", "src/utils/helpers.ts"],
  always: ["*"],
  args: {
    filepath: "src/components/App.tsx, src/utils/helpers.ts",
    files: [
      {
        relativePath: "src/components/App.tsx",
        type: "update",
        patch:
          '===================================================================\n--- src/components/App.tsx\n+++ src/components/App.tsx\n@@ -1,3 +1,4 @@\n import { Button } from "@kilocode/kilo-ui/button"\n+import { Card } from "@kilocode/kilo-ui/card"\n \n export function App() {\n',
        additions: 1,
        deletions: 0,
      },
      {
        relativePath: "src/utils/helpers.ts",
        type: "update",
        patch:
          "===================================================================\n--- src/utils/helpers.ts\n+++ src/utils/helpers.ts\n@@ -1,3 +1,3 @@\n export function label(value: string) {\n-  return value\n+  return value.trim()\n }\n",
        additions: 1,
        deletions: 1,
      },
    ],
  },
  tool: { messageID: ASST_MSG_ID, callID: "call-patch-001" },
}

export const PermissionDockEdit: Story = {
  name: "Permission Dock — edit",
  render: () => {
    const perms = [editPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "350px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const PermissionDockApplyPatch: Story = {
  name: "Permission Dock - apply patch",
  render: () => {
    const perms = [applyPatchPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "420px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 13. Permission dock — websearch tool
// ---------------------------------------------------------------------------

const websearchPermission: PermissionRequest = {
  id: "perm-websearch-001",
  sessionID: SESSION_ID,
  toolName: "websearch",
  patterns: ["*"],
  always: ["*"],
  args: {},
  tool: { messageID: ASST_MSG_ID, callID: "call-websearch-001" },
}

export const PermissionDockWebsearch: Story = {
  name: "Permission Dock — websearch",
  render: () => {
    const perms = [websearchPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "300px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 14. Permission dock — external_directory tool
// ---------------------------------------------------------------------------

const externalDirPermission: PermissionRequest = {
  id: "perm-extdir-001",
  sessionID: SESSION_ID,
  toolName: "external_directory",
  patterns: ["/home/user/other-project/*"],
  always: ["/home/user/other-project/*"],
  args: { filepath: "/home/user/other-project/config.json" },
  tool: { messageID: ASST_MSG_ID, callID: "call-extdir-001" },
}

export const PermissionDockExternalDir: Story = {
  name: "Permission Dock — external directory",
  render: () => {
    const perms = [externalDirPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "300px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 15. Permission dock — bash with many rules (5+ rules for overflow testing)
// ---------------------------------------------------------------------------

const bashManyRulesPermission: PermissionRequest = {
  id: "perm-bash-many-001",
  sessionID: SESSION_ID,
  toolName: "bash",
  patterns: ["npm install"],
  always: ["npm install *"],
  args: {
    command: "npm install",
    rules: ["npm *", "npm install", "npm run *", "npm test", "npm run build", "npx *"],
  },
  tool: { messageID: ASST_MSG_ID, callID: "call-bash-many-001" },
}

export const PermissionDockBashManyRules: Story = {
  name: "Permission Dock — bash many rules",
  render: () => {
    const perms = [bashManyRulesPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "400px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 16. Permission dock — subagent (from child session)
// ---------------------------------------------------------------------------

const subagentPermission: PermissionRequest = {
  id: "perm-subagent-001",
  sessionID: "child-session-001",
  toolName: "bash",
  patterns: ["git status"],
  always: ["git status *"],
  args: { command: "git status", rules: ["git *", "git status"] },
  tool: { messageID: ASST_MSG_ID, callID: "call-subagent-001" },
}

export const PermissionDockSubagent: Story = {
  name: "Permission Dock — subagent",
  render: () => {
    const perms = [subagentPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
      // Override scopedPermissions to include child session permissions in the family
      scopedPermissions: () => perms,
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "300px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 17. Permission dock — bash with pre-populated config rules
// ---------------------------------------------------------------------------

const bashConfigPermission: PermissionRequest = {
  id: "perm-bash-config-001",
  sessionID: SESSION_ID,
  toolName: "bash",
  patterns: ["npm install"],
  always: ["npm install *"],
  args: {
    command: "npm install",
    rules: ["npm *", "npm install", "npm run *", "npm test", "git *", "npx *"],
  },
  tool: { messageID: ASST_MSG_ID, callID: "call-bash-config-001" },
}

export const PermissionDockConfigPreloaded: Story = {
  name: "Permission Dock — config pre-populated",
  render: () => {
    const perms = [bashConfigPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders
        permissions={perms}
        sessionID={SESSION_ID}
        status="busy"
        noPadding
        config={{
          permission: {
            bash: {
              "*": "ask",
              "npm *": "allow",
              "npm install": "allow",
              "git *": "deny",
            },
          },
        }}
      >
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "400px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 18. Permission dock — bash with very long heredoc command
// ---------------------------------------------------------------------------

const heredocPermission: PermissionRequest = {
  id: "perm-heredoc-001",
  sessionID: SESSION_ID,
  toolName: "bash",
  patterns: ["python3"],
  always: ["python3 *"],
  args: {
    command: `python3 << 'EOF'
import json
from collections import defaultdict
from pathlib import Path

events_path = Path('test_sound/events.json')
extracted_dir = Path('test_sound/extracted')

with open(events_path) as f:
    events = json.load(f)

# Gather all expected entries and their details
expected = []  # list of (fsb, index, name, event_path, entry_obj)
for project in events.get('projects', []):
    for event in project.get('events', []):
        for region in event.get('sound_defs', []):
            for def_ in region.get('defs', []):
                for entry in def_.get('entries', []):
                    if entry.get('type') == 'wavatable':
                        expected.append((
                            entry.get('fsb'),
                            entry.get('subsound_index'),
                            entry.get('subsound_name'),
                            event.get('path'),
                            entry
                        ))

print(f"Total wavetable entries in events.json: {len(expected)}")

# Check which ones got audio_file set
found_audio = 0
for _, _, _, _, entry in expected:
    if entry.get('audio_file'):
        found_audio += 1

print(f"Entries with audio_file set: {found_audio}")
print(f"Missing audio_file: {len(expected) - found_audio}")
EOF`,
    rules: ["python3 *"],
  },
  tool: { messageID: ASST_MSG_ID, callID: "call-heredoc-001" },
}

export const PermissionDockHeredoc: Story = {
  name: "Permission Dock — bash heredoc (long command)",
  render: () => {
    const perms = [heredocPermission]
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy", permissions: perms }),
      messages: () => [{ id: "msg-001" }] as any[],
    }
    return (
      <StoryProviders permissions={perms} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "400px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 17. MCP tool cards — collapsed
// ---------------------------------------------------------------------------

const mcpCompleted: ToolPart = {
  id: "part-mcp-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-mcp-001",
  tool: "vercel_search_vercel_documentation",
  state: {
    status: "completed",
    input: { topic: "serverless functions" },
    output:
      "## Serverless Function Configuration\n\nSource: https://vercel.com/docs/build-output-api/primitives\n\nThis TypeScript type definition (`ServerlessFunctionConfig`) specifies configuration for Vercel Serverless Functions.\n\n```ts\ntype ServerlessFunctionConfig = {\n  handler: string;\n  runtime: string;\n  memory?: number;\n  maxDuration?: number;\n}\n```",
    title: "Search Vercel docs",
    metadata: {},
    time: { start: now - 4000, end: now - 3500 },
  },
}

const mcpShort: ToolPart = {
  id: "part-mcp-002",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-mcp-002",
  tool: "sentry_search_issues",
  state: {
    status: "completed",
    input: { query: "unresolved errors" },
    output:
      "Found 3 issues:\n- PROJ-123: TypeError in auth flow\n- PROJ-456: Network timeout\n- PROJ-789: Null reference",
    title: "Search issues",
    metadata: {},
    time: { start: now - 3000, end: now - 2800 },
  },
}

export const McpToolCards: Story = {
  name: "MCP Tool Cards — collapsed",
  render: () => {
    const data = dataWith([mcpCompleted, mcpShort])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 18. MCP tool card — expanded (defaultOpen)
// ---------------------------------------------------------------------------

export const McpToolExpanded: Story = {
  name: "MCP Tool Card — expanded",
  render: () => {
    const data = dataWith([mcpCompleted])
    return (
      <StoryProviders data={data} sessionID={SESSION_ID}>
        <div data-component="tool-part-wrapper" data-part-type="tool">
          <Part part={mcpCompleted} message={baseAssistantMessage as any} defaultOpen />
        </div>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 19. Diff summary — "Modified N files" collapsed header
// ---------------------------------------------------------------------------

const USER_MSG_ID = "user-msg-diff-001"

const mockDiffs = [
  { file: "src/components/App.tsx", before: "", after: "", additions: 12, deletions: 3, status: "modified" as const },
  { file: "src/utils/helpers.ts", before: "", after: "", additions: 5, deletions: 8, status: "modified" as const },
  { file: "src/styles/main.css", before: "", after: "", additions: 20, deletions: 0, status: "added" as const },
]

export const DiffSummaryCollapsed: Story = {
  name: "Diff Summary — Modified N files (collapsed)",
  render: () => {
    const data = {
      ...defaultMockData,
      message: {
        [SESSION_ID]: [
          {
            id: USER_MSG_ID,
            sessionID: SESSION_ID,
            role: "user",
            time: { created: now - 10000 },
            summary: { diffs: mockDiffs },
          },
          { ...baseAssistantMessage, parentID: USER_MSG_ID },
        ],
      },
      part: {
        [USER_MSG_ID]: [
          { id: "part-user-text", sessionID: SESSION_ID, messageID: USER_MSG_ID, type: "text", text: "Fix the bug" },
        ],
        [ASST_MSG_ID]: [textPart],
      },
    }
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
      messages: () => data.message[SESSION_ID],
    }
    const server = {
      connectionState: () => "connected" as const,
      serverInfo: () => undefined,
      extensionVersion: () => "1.0.0",
      errorMessage: () => undefined,
      errorDetails: () => undefined,
      isConnected: () => true,
      profileData: () => null,
      deviceAuth: () => ({ status: "idle" as const }),
      startLogin: () => {},
      goToLogin: () => {},
      vscodeLanguage: () => "en",
      languageOverride: () => undefined,
      workspaceDirectory: () => "/project",
      gitInstalled: () => true,
    }
    return (
      <StoryProviders data={data} sessionID={SESSION_ID} status="idle" noPadding>
        <ServerContext.Provider value={server as any}>
          <SessionContext.Provider value={session as any}>
            <div style={{ width: "380px", padding: "12px" }}>
              <VscodeSessionTurn
                turn={{
                  id: USER_MSG_ID,
                  user: data.message[SESSION_ID][0] as any,
                  assistant: [data.message[SESSION_ID][1] as any],
                }}
              />
            </div>
          </SessionContext.Provider>
        </ServerContext.Provider>
      </StoryProviders>
    )
  },
}
