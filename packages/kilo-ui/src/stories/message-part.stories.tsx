/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { UserMessageDisplay, AssistantParts } from "../components/message-part"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { Diff } from "@kilocode/kilo-ui/diff"
import { Code } from "@kilocode/kilo-ui/code"
import { File } from "@kilocode/kilo-ui/file"
import type { UserMessage, AssistantMessage, TextPart, ToolPart, ReasoningPart } from "@kilocode/sdk/v2"

const SESSION_ID = "session-story-001"
const USER_MSG_ID = "user-msg-001"
const ASST_MSG_ID = "asst-msg-001"
const now = Date.now()

const mockUserMessage: UserMessage = {
  id: USER_MSG_ID,
  sessionID: SESSION_ID,
  role: "user",
  time: { created: now - 10000 },
  agent: "default",
  model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
}

const mockAssistantMessage: AssistantMessage = {
  id: ASST_MSG_ID,
  sessionID: SESSION_ID,
  role: "assistant",
  parentID: USER_MSG_ID,
  time: { created: now - 9000, completed: now - 5000 },
  modelID: "claude-3-5-sonnet",
  providerID: "anthropic",
  mode: "default",
  agent: "default",
  path: { cwd: "/project", root: "/project" },
  cost: 0.0023,
  tokens: { total: 512, input: 256, output: 256, reasoning: 0, cache: { read: 0, write: 0 } },
}

const textPart: TextPart = {
  id: "part-text-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "text",
  text: "I've analyzed the codebase and here is what I found:\n\n- The `Counter` component works correctly but lacks error boundaries\n- The `package.json` dependencies are slightly outdated\n- Consider adding unit tests for the utility functions",
}

const userTextPart: TextPart = {
  id: "part-user-text-001",
  sessionID: SESSION_ID,
  messageID: USER_MSG_ID,
  type: "text",
  text: "Can you review my code and suggest improvements?",
}

// --- Context group tools (read/glob/grep/list) → grouped header path ---

const completedToolPart: ToolPart = {
  id: "part-tool-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-read-001",
  tool: "read",
  state: {
    status: "completed",
    input: { filePath: "src/counter.tsx" },
    output: "import { createSignal } from 'solid-js'\nexport function Counter() { ... }",
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
    input: { pattern: "createSignal", path: "src/" },
    output:
      "src/counter.tsx:1: import { createSignal } from 'solid-js'\nsrc/app.tsx:3: const [count, setCount] = createSignal(0)",
    title: "Search",
    metadata: {},
    time: { start: now - 7800, end: now - 7400 },
  },
}

const globCompleted: ToolPart = {
  id: "part-glob-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-glob-001",
  tool: "glob",
  state: {
    status: "completed",
    input: { pattern: "src/**/*.tsx", path: "." },
    output: "src/counter.tsx\nsrc/app.tsx\nsrc/index.tsx",
    title: "Found 3 files",
    metadata: {},
    time: { start: now - 7600, end: now - 7300 },
  },
}

// --- Bash tool → ShellRollingResults path ---

const bashCompleted: ToolPart = {
  id: "part-bash-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-bash-001",
  tool: "bash",
  state: {
    status: "completed",
    input: { description: "Run tests", command: "bun test" },
    output:
      "bun test v1.0.0\n\n✓ counter.test.tsx > renders correctly (2ms)\n✓ counter.test.tsx > increments count (1ms)\n\n2 tests passed [34ms]",
    title: "Run tests",
    metadata: {},
    time: { start: now - 5000, end: now - 4500 },
  },
}

// --- Edit tool → normal Part/ToolPartDisplay path (non-bash, non-context-group) ---

const runningToolPart: ToolPart = {
  id: "part-tool-002",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-edit-001",
  tool: "edit",
  state: {
    status: "running",
    input: { filePath: "src/counter.tsx" },
    metadata: {},
    time: { start: now - 3000 },
  },
}

const errorToolPart: ToolPart = {
  id: "part-tool-003",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-edit-002",
  tool: "edit",
  state: {
    status: "error",
    input: { filePath: "src/missing-file.tsx" },
    error: "ENOENT: no such file or directory 'src/missing-file.tsx'",
    time: { start: now - 6000, end: now - 5500 },
  },
}

// --- Reasoning part ---

const reasoningPart: ReasoningPart = {
  id: "part-reasoning-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "reasoning",
  text: "Let me think about this carefully. The user wants code improvements.\n\n1. First, I should check for error boundaries — they prevent cascading failures\n2. The dependencies could be updated to newer minor versions\n3. Unit tests would improve confidence in refactoring later\n\nI'll structure my response to address each point clearly.",
  time: { start: now - 9000, end: now - 8500 },
}

// ---------------------------------------------------------------------------
// Mock data factory — static constants avoid re-creating arrays on every
// reactive access, which would cause SolidJS to see constant "changes".
// ---------------------------------------------------------------------------

function createMockData(parts: (TextPart | ToolPart | ReasoningPart)[]) {
  return {
    session: [],
    session_status: {},
    session_diff: {},
    message: {
      [SESSION_ID]: [mockUserMessage, mockAssistantMessage],
    },
    part: {
      [USER_MSG_ID]: [userTextPart],
      [ASST_MSG_ID]: parts,
    },
  }
}

type MockData = ReturnType<typeof createMockData>

// AssistantMessage + text + completed read (context group grouped header)
const mockData = createMockData([completedToolPart, textPart])
// Only the running edit tool — matches old WithRunningTool single-part intent
const mockDataRunning = createMockData([runningToolPart])
// Only the error edit tool — matches old WithErrorTool single-part intent
const mockDataError = createMockData([errorToolPart])
// Reasoning + text — matches old WithReasoning single-reasoning intent
const mockDataReasoning = createMockData([reasoningPart, textPart])
// Completed bash tool — exercises ShellRollingResults path
const mockDataBash = createMockData([bashCompleted])
// Three context-group tools — exercises ContextToolGroupHeader collapse path
const mockDataContextGroup = createMockData([completedToolPart, grepCompleted, globCompleted, textPart])

function AllProviders(props: { children: any; data?: MockData }) {
  return (
    <DataProvider data={props.data ?? mockData} directory="/project">
      <DiffComponentProvider component={Diff}>
        <CodeComponentProvider component={Code}>
          <FileComponentProvider component={File}>
            <DialogProvider>
              <MarkedProvider>
                <div style={{ padding: "16px", "max-width": "700px" }}>{props.children}</div>
              </MarkedProvider>
            </DialogProvider>
          </FileComponentProvider>
        </CodeComponentProvider>
      </DiffComponentProvider>
    </DataProvider>
  )
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "Components/MessagePart",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

// --- User message bubble ---

export const UserMessageStory: Story = {
  name: "UserMessage",
  render: () => (
    <AllProviders>
      <UserMessageDisplay message={mockUserMessage} parts={[userTextPart]} />
    </AllProviders>
  ),
}

// --- Assistant: text + one completed read tool (grouped header) ---

export const AssistantMessageStory: Story = {
  name: "AssistantMessage",
  render: () => (
    <AllProviders>
      <AssistantParts messages={[mockAssistantMessage]} />
    </AllProviders>
  ),
}

// --- Edit tool in running/pending state (Part → ToolPartDisplay path) ---

export const WithRunningTool: Story = {
  render: () => (
    <AllProviders data={mockDataRunning}>
      <AssistantParts messages={[mockAssistantMessage]} working />
    </AllProviders>
  ),
}

// --- Edit tool in error state → renders red error card ---

export const WithErrorTool: Story = {
  render: () => (
    <AllProviders data={mockDataError}>
      <AssistantParts messages={[mockAssistantMessage]} />
    </AllProviders>
  ),
}

// --- User + assistant stacked (tool first, then text — matches original order) ---

export const FullConversationTurn: Story = {
  render: () => (
    <AllProviders>
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <UserMessageDisplay message={mockUserMessage} parts={[userTextPart]} />
        <AssistantParts messages={[mockAssistantMessage]} />
      </div>
    </AllProviders>
  ),
}

// --- Reasoning block collapsed (default state) ---

export const WithReasoningCollapsed: Story = {
  name: "WithReasoning (collapsed)",
  render: () => (
    <AllProviders data={mockDataReasoning}>
      <AssistantParts messages={[mockAssistantMessage]} />
    </AllProviders>
  ),
}

// --- Reasoning block expanded via play interaction ---

export const WithReasoningExpanded: Story = {
  name: "WithReasoning (expanded)",
  render: () => (
    <AllProviders data={mockDataReasoning}>
      <AssistantParts messages={[mockAssistantMessage]} />
    </AllProviders>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const trigger = canvasElement.querySelector("[data-slot='reasoning-header']")?.closest("button")
    if (trigger) trigger.click()
  },
}

// --- Bash tool (completed, collapsed) — exercises the ShellRollingResults path ---

export const WithBashTool: Story = {
  render: () => (
    <AllProviders data={mockDataBash}>
      <AssistantParts messages={[mockAssistantMessage]} />
    </AllProviders>
  ),
}

// --- Bash tool (completed, expanded) — play clicks the header to open the output panel ---

export const WithBashToolExpanded: Story = {
  render: () => (
    <AllProviders data={mockDataBash}>
      <AssistantParts messages={[mockAssistantMessage]} />
    </AllProviders>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const header = canvasElement.querySelector("[data-slot='shell-rolling-header-clip']") as HTMLElement | null
    if (header) header.click()
  },
}

// --- Three context-group tools + text — exercises ContextToolGroupHeader collapse ---

export const WithContextGroup: Story = {
  render: () => (
    <AllProviders data={mockDataContextGroup}>
      <AssistantParts messages={[mockAssistantMessage]} />
    </AllProviders>
  ),
}

// --- All 5 tool hint error types in a single screenshot ---

const hintErrors: ToolPart[] = [
  {
    id: "part-hint-001",
    sessionID: SESSION_ID,
    messageID: ASST_MSG_ID,
    type: "tool",
    callID: "call-hint-001",
    tool: "write",
    state: {
      status: "error",
      input: { filePath: "src/config.ts" },
      error:
        "Error: File already exists — read it before overwriting it. Use the Read tool first to see its current contents.",
      time: { start: now - 6000, end: now - 5500 },
    },
  },
  {
    id: "part-hint-002",
    sessionID: SESSION_ID,
    messageID: ASST_MSG_ID,
    type: "tool",
    callID: "call-hint-002",
    tool: "edit",
    state: {
      status: "error",
      input: { filePath: "src/app.tsx" },
      error: "Error: File has been modified since it was last read. Please read it again before editing.",
      time: { start: now - 5500, end: now - 5000 },
    },
  },
  {
    id: "part-hint-003",
    sessionID: SESSION_ID,
    messageID: ASST_MSG_ID,
    type: "tool",
    callID: "call-hint-003",
    tool: "edit",
    state: {
      status: "error",
      input: { filePath: "src/utils.ts" },
      error: "Error: oldString and newString are identical. No changes were made.",
      time: { start: now - 5000, end: now - 4500 },
    },
  },
  {
    id: "part-hint-004",
    sessionID: SESSION_ID,
    messageID: ASST_MSG_ID,
    type: "tool",
    callID: "call-hint-004",
    tool: "edit",
    state: {
      status: "error",
      input: { filePath: "src/index.ts" },
      error:
        "Error: oldString not found in file. The oldString must match exactly, including whitespace and indentation.",
      time: { start: now - 4500, end: now - 4000 },
    },
  },
  {
    id: "part-hint-005",
    sessionID: SESSION_ID,
    messageID: ASST_MSG_ID,
    type: "tool",
    callID: "call-hint-005",
    tool: "edit",
    state: {
      status: "error",
      input: { filePath: "src/counter.tsx" },
      error:
        "Error: Found multiple matches for oldString. Provide more surrounding lines to identify the correct match.",
      time: { start: now - 4000, end: now - 3500 },
    },
  },
]

const mockDataHintErrors = createMockData(hintErrors)

export const ToolHintErrors: Story = {
  render: () => (
    <AllProviders data={mockDataHintErrors}>
      <AssistantParts messages={[mockAssistantMessage]} />
    </AllProviders>
  ),
}
