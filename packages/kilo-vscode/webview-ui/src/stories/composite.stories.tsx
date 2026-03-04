/** @jsxImportSource solid-js */
/**
 * Composite visual regression stories for the kilo-vscode webview.
 *
 * These test the *composed* UI — how kilo-ui components look together
 * in the extension webview context with extension-specific styling,
 * inline permission prompts, and tool card overrides.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { For, Show } from "solid-js"
import { Part } from "@kilocode/kilo-ui/message-part"
import { BasicTool } from "@kilocode/kilo-ui/basic-tool"
import { Button } from "@kilocode/kilo-ui/button"
import type {
  AssistantMessage as SDKAssistantMessage,
  TextPart,
  ToolPart,
  Message as SDKMessage,
} from "@kilocode/sdk/v2"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { AssistantMessage } from "../components/chat/AssistantMessage"
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
import { SessionContext } from "../context/session"
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

const globPending: ToolPart = {
  id: "part-glob-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-glob-001",
  tool: "glob",
  state: {
    status: "pending",
    input: { pattern: "**/*.md", path: "." },
    title: "Searching for files",
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

const bashPending: ToolPart = {
  id: "part-bash-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-bash-001",
  tool: "bash",
  state: {
    status: "pending",
    input: { description: "Run tests", command: "bun test" },
    title: "Execute command",
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
  args: { pattern: "**/*.md" },
  tool: { messageID: ASST_MSG_ID, callID: "call-glob-001" },
}

const bashPermission: PermissionRequest = {
  id: "perm-bash-001",
  sessionID: SESSION_ID,
  toolName: "bash",
  patterns: ["bun test"],
  args: { command: "bun test" },
  tool: { messageID: ASST_MSG_ID, callID: "call-bash-001" },
}

const dockPermission: PermissionRequest = {
  id: "perm-dock-001",
  sessionID: SESSION_ID,
  toolName: "write",
  patterns: ["src/main.tsx", "src/utils.ts"],
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
    permission: permissions
      ? { [SESSION_ID]: permissions }
      : {},
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
// 1. Tool with inline permission (glob)
// ---------------------------------------------------------------------------

export const GlobWithPermission: Story = {
  name: "Glob + Inline Permission",
  render: () => {
    const perms = [globPermission]
    const data = dataWith([globPending], perms)
    return (
      <StoryProviders data={data} permissions={perms} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 2. Tool with inline permission (bash)
// ---------------------------------------------------------------------------

export const BashWithPermission: Story = {
  name: "Bash + Inline Permission",
  render: () => {
    const perms = [bashPermission]
    const data = dataWith([bashPending], perms)
    return (
      <StoryProviders data={data} permissions={perms} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// 3. Permission dock (non-tool bottom prompt)
// ---------------------------------------------------------------------------

export const PermissionDock: Story = {
  name: "Permission Dock",
  render: () => {
    const perm = dockPermission
    return (
      <StoryProviders sessionID={SESSION_ID}>
        <div data-component="tool-part-wrapper" data-permission="true">
          <BasicTool
            icon="checklist"
            locked
            defaultOpen
            trigger={{
              title: "Permission required",
              subtitle: perm.toolName,
            }}
          >
            <Show when={perm.patterns.length > 0}>
              <div class="permission-dock-patterns">
                <For each={perm.patterns}>
                  {(pattern) => <code class="permission-dock-pattern">{pattern}</code>}
                </For>
              </div>
            </Show>
          </BasicTool>
          <div data-component="permission-prompt">
            <div data-slot="permission-actions">
              <Button variant="ghost" size="small">
                Deny
              </Button>
              <Button variant="secondary" size="small">
                Always Allow
              </Button>
              <Button variant="primary" size="small">
                Allow Once
              </Button>
            </div>
            <p data-slot="permission-hint">Approval applies only to the current session</p>
          </div>
        </div>
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
// 8. Inline question (tool-linked question rendered in message flow)
// ---------------------------------------------------------------------------

export const InlineQuestion: Story = {
  name: "Inline Question",
  render: () => {
    const qs = [questionRequest]
    const data = dataWith([textPart, questionToolPart])
    return (
      <StoryProviders data={data} questions={qs} sessionID={SESSION_ID}>
        <AssistantMessage message={baseAssistantMessage} />
      </StoryProviders>
    )
  },
}
