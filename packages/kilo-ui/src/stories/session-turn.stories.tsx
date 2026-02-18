/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { SessionTurn } from "@opencode-ai/ui/session-turn"
import { DataProvider } from "@opencode-ai/ui/context/data"
import { DiffComponentProvider } from "@opencode-ai/ui/context/diff"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { Diff } from "@opencode-ai/ui/diff"
import type { UserMessage, AssistantMessage, TextPart, ToolPart } from "@kilocode/sdk/v2"

const SESSION_ID = "session-turn-story-001"
const USER_MSG_ID = "user-turn-msg-001"
const ASST_MSG_ID = "asst-turn-msg-001"
const now = Date.now()

const userMessage: UserMessage = {
  id: USER_MSG_ID,
  sessionID: SESSION_ID,
  role: "user",
  time: { created: now - 15000 },
  agent: "default",
  model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
}

const assistantMessage: AssistantMessage = {
  id: ASST_MSG_ID,
  sessionID: SESSION_ID,
  role: "assistant",
  parentID: USER_MSG_ID,
  time: { created: now - 14000, completed: now - 10000 },
  modelID: "claude-3-5-sonnet",
  providerID: "anthropic",
  mode: "default",
  agent: "default",
  path: { cwd: "/project", root: "/project" },
  cost: 0.0031,
  tokens: { total: 640, input: 320, output: 320, reasoning: 0, cache: { read: 0, write: 0 } },
}

const userTextPart: TextPart = {
  id: "turn-part-user-001",
  sessionID: SESSION_ID,
  messageID: USER_MSG_ID,
  type: "text",
  text: "Please review the counter component and suggest improvements.",
}

const readToolPart: ToolPart = {
  id: "turn-part-tool-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "tool",
  callID: "call-read-turn-001",
  tool: "read",
  state: {
    status: "completed",
    input: { filePath: "src/counter.tsx" },
    output: "import { createSignal } from 'solid-js'\nexport function Counter() { ... }",
    title: "Read src/counter.tsx",
    metadata: {},
    time: { start: now - 13000, end: now - 12500 },
  },
}

const responseTextPart: TextPart = {
  id: "turn-part-text-001",
  sessionID: SESSION_ID,
  messageID: ASST_MSG_ID,
  type: "text",
  text: "I've reviewed the `Counter` component. Here are my suggestions:\n\n1. **Add TypeScript types** — The component accepts no props currently. Consider adding an `initial` prop with a default value.\n2. **Add a reset button** — This would improve usability.\n3. **Consider using `createStore`** for more complex state if you add more fields.\n\nOverall the component is clean and idiomatic SolidJS.",
}

const SESSION_ID_2 = "session-turn-story-002"
const USER_MSG_ID_2 = "user-turn-msg-002"
const ASST_MSG_ID_2 = "asst-turn-msg-002"

const workingUserMessage: UserMessage = {
  id: USER_MSG_ID_2,
  sessionID: SESSION_ID_2,
  role: "user",
  time: { created: now - 5000 },
  agent: "default",
  model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
}

const workingUserTextPart: TextPart = {
  id: "turn-part-user-002",
  sessionID: SESSION_ID_2,
  messageID: USER_MSG_ID_2,
  type: "text",
  text: "Run the test suite and fix any failing tests.",
}

const runningBashPart: ToolPart = {
  id: "turn-part-tool-002",
  sessionID: SESSION_ID_2,
  messageID: ASST_MSG_ID_2,
  type: "tool",
  callID: "call-bash-turn-001",
  tool: "bash",
  state: {
    status: "running",
    input: { description: "Run test suite", command: "bun test" },
    title: "Running bun test...",
    metadata: {},
    time: { start: now - 3000 },
  },
}

const workingAssistantMessage: AssistantMessage = {
  id: ASST_MSG_ID_2,
  sessionID: SESSION_ID_2,
  role: "assistant",
  parentID: USER_MSG_ID_2,
  time: { created: now - 4500 },
  modelID: "claude-3-5-sonnet",
  providerID: "anthropic",
  mode: "default",
  agent: "default",
  path: { cwd: "/project", root: "/project" },
  cost: 0.001,
  tokens: { total: 128, input: 100, output: 28, reasoning: 0, cache: { read: 0, write: 0 } },
}

const baseData = {
  session: [],
  session_status: { [SESSION_ID]: { type: "idle" as const } },
  session_diff: {},
  message: {
    [SESSION_ID]: [userMessage, assistantMessage],
  },
  part: {
    [USER_MSG_ID]: [userTextPart],
    [ASST_MSG_ID]: [readToolPart, responseTextPart],
  },
}

const workingData = {
  session: [],
  session_status: { [SESSION_ID_2]: { type: "busy" as const } },
  session_diff: {},
  message: {
    [SESSION_ID_2]: [workingUserMessage, workingAssistantMessage],
  },
  part: {
    [USER_MSG_ID_2]: [workingUserTextPart],
    [ASST_MSG_ID_2]: [runningBashPart],
  },
}

function Providers(props: { data: any; children: any }) {
  return (
    <DataProvider data={props.data} directory="/project">
      <DiffComponentProvider component={Diff}>
        <DialogProvider>
          <MarkedProvider>{props.children}</MarkedProvider>
        </DialogProvider>
      </DiffComponentProvider>
    </DataProvider>
  )
}

const meta: Meta = {
  title: "Components/SessionTurn",
  parameters: { layout: "padded" },
}

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <Providers data={baseData}>
      <div style={{ width: "700px" }}>
        <SessionTurn sessionID={SESSION_ID} messageID={USER_MSG_ID} lastUserMessageID={USER_MSG_ID} />
      </div>
    </Providers>
  ),
}

export const Working: Story = {
  render: () => (
    <Providers data={workingData}>
      <div style={{ width: "700px" }}>
        <SessionTurn sessionID={SESSION_ID_2} messageID={USER_MSG_ID_2} lastUserMessageID={USER_MSG_ID_2} />
      </div>
    </Providers>
  ),
}

export const WithStepsExpanded: Story = {
  render: () => (
    <Providers data={baseData}>
      <div style={{ width: "700px" }}>
        <SessionTurn sessionID={SESSION_ID} messageID={USER_MSG_ID} lastUserMessageID={USER_MSG_ID} stepsExpanded />
      </div>
    </Providers>
  ),
}
