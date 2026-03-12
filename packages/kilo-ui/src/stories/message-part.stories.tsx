/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Message, AssistantMessageDisplay, UserMessageDisplay } from "@opencode-ai/ui/message-part"
// Side-effect import: registers kilo-ui's PART_MAPPING override for reasoning blocks
import "../components/message-part"
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

const runningToolPart: ToolPart = {
  id: "part-tool-002",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-bash-001",
  tool: "bash",
  state: {
    status: "running",
    input: { description: "Run tests", command: "bun test" },
    title: "Running tests...",
    metadata: {},
    time: { start: now - 3000 },
  },
}

const errorToolPart: ToolPart = {
  id: "part-tool-003",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-bash-002",
  tool: "bash",
  state: {
    status: "error",
    input: { description: "Build project", command: "bun build" },
    error: "Build failed: Module not found 'missing-dep'",
    metadata: {},
    time: { start: now - 6000, end: now - 5500 },
  },
}

const reasoningPart: ReasoningPart = {
  id: "part-reasoning-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "reasoning",
  text: "Let me think about this carefully. The user wants code improvements.\n\n1. First, I should check for error boundaries — they prevent cascading failures\n2. The dependencies could be updated to newer minor versions\n3. Unit tests would improve confidence in refactoring later\n\nI'll structure my response to address each point clearly.",
  time: { start: now - 9000, end: now - 8500 },
}

const mockData = {
  session: [],
  session_status: {},
  session_diff: {},
  message: {
    [SESSION_ID]: [mockUserMessage, mockAssistantMessage],
  },
  part: {
    [USER_MSG_ID]: [userTextPart],
    [ASST_MSG_ID]: [textPart, completedToolPart],
  },
}

function AllProviders(props: { children: any }) {
  return (
    <DataProvider data={mockData} directory="/project">
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

const meta: Meta = {
  title: "Components/MessagePart",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

export const UserMessageStory: Story = {
  name: "UserMessage",
  render: () => (
    <AllProviders>
      <UserMessageDisplay message={mockUserMessage} parts={[userTextPart]} />
    </AllProviders>
  ),
}

export const AssistantMessageStory: Story = {
  name: "AssistantMessage",
  render: () => (
    <AllProviders>
      <AssistantMessageDisplay message={mockAssistantMessage} parts={[textPart, completedToolPart]} />
    </AllProviders>
  ),
}

export const WithRunningTool: Story = {
  render: () => (
    <AllProviders>
      <AssistantMessageDisplay message={mockAssistantMessage} parts={[runningToolPart]} />
    </AllProviders>
  ),
}

export const WithErrorTool: Story = {
  render: () => (
    <AllProviders>
      <AssistantMessageDisplay message={mockAssistantMessage} parts={[errorToolPart]} />
    </AllProviders>
  ),
}

export const FullConversationTurn: Story = {
  render: () => (
    <AllProviders>
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <UserMessageDisplay message={mockUserMessage} parts={[userTextPart]} />
        <AssistantMessageDisplay message={mockAssistantMessage} parts={[completedToolPart, textPart]} />
      </div>
    </AllProviders>
  ),
}

export const WithReasoningCollapsed: Story = {
  name: "WithReasoning (collapsed)",
  render: () => (
    <AllProviders>
      <AssistantMessageDisplay message={mockAssistantMessage} parts={[reasoningPart, textPart]} />
    </AllProviders>
  ),
}

export const WithReasoningExpanded: Story = {
  name: "WithReasoning (expanded)",
  render: () => {
    // Use a wrapper to render with the collapsible open by default
    const expandedReasoningPart = { ...reasoningPart, id: "part-reasoning-expanded" }
    return (
      <AllProviders>
        <AssistantMessageDisplay message={mockAssistantMessage} parts={[expandedReasoningPart, textPart]} />
      </AllProviders>
    )
  },
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    // Click the collapsible trigger to expand it
    const trigger = canvasElement.querySelector("[data-slot='reasoning-header']")?.closest("button")
    if (trigger) trigger.click()
  },
}

export const MessageSwitch: Story = {
  render: () => (
    <AllProviders>
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
        <Message message={mockUserMessage} parts={[userTextPart]} />
        <Message message={mockAssistantMessage} parts={[textPart, completedToolPart]} />
      </div>
    </AllProviders>
  ),
}
