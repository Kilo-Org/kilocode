/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { Part } from "@kilocode/kilo-ui/message-part"
import { StoryProviders } from "./StoryProviders"
import type { AssistantMessage, ToolPart } from "@kilocode/sdk/v2"

const SESSION_ID = "shell-story-001"
const MSG_ID = "shell-msg-001"
const now = Date.now()

const assistantMessage: AssistantMessage = {
  id: MSG_ID,
  sessionID: SESSION_ID,
  role: "assistant",
  parentID: "user-msg-001",
  time: { created: now - 5000, completed: now - 4000 },
  modelID: "claude-3-5-sonnet",
  providerID: "anthropic",
  mode: "default",
  agent: "default",
  path: { cwd: "/project", root: "/project" },
  cost: 0.001,
  tokens: { total: 128, input: 100, output: 28, reasoning: 0, cache: { read: 0, write: 0 } },
}

const shellPart: ToolPart = {
  id: "shell-tool-001",
  sessionID: SESSION_ID,
  messageID: MSG_ID,
  type: "tool",
  callID: "call-shell-001",
  tool: "bash",
  state: {
    status: "completed",
    input: {
      description: "Check for migration message types",
      command: `grep -n "migration\\|openMigration" packages/kilo-vscode/webview-ui/src/types/messages.ts`,
    },
    output: `534:  view: "newTask" | "marketplace" | "history" | "profile" | "settings" | "migration" // legacy-migration`,
    title: "Check for migration message types",
    metadata: {},
    time: { start: now - 5000, end: now - 4500 },
  },
}

const mockData = {
  session: [],
  session_status: {},
  session_diff: {},
  message: { [SESSION_ID]: [assistantMessage] },
  part: { [MSG_ID]: [shellPart] },
  permission: {},
  question: {},
  provider: { all: [], connected: false, default: {} },
}

const meta: Meta = {
  title: "Components/Shell",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

export const ShellExecution: Story = {
  render: () => (
    <StoryProviders data={mockData} noPadding>
      <div style={{ padding: "16px", "max-width": "700px" }}>
        <div data-component="tool-part-wrapper" data-part-type="tool">
          <Part part={shellPart} message={assistantMessage} defaultOpen />
        </div>
      </div>
    </StoryProviders>
  ),
}
