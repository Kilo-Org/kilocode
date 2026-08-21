/** @jsxImportSource solid-js */
import { For, Show, createSignal, type Component } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import type {
  AssistantMessage as SDKAssistantMessage,
  Part as SDKPart,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@kilocode/sdk/v2"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { AssistantMessage } from "../components/chat/AssistantMessage"
import { ToolActivityGroup } from "../components/chat/ToolActivityGroup"
import { registerExpandedTaskTool } from "../components/chat/TaskToolExpanded"
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
import { SessionContext } from "../context/session"

registerExpandedTaskTool()
registerVscodeToolOverrides()

const SID = "tool-activity-session"
const MID = "tool-activity-message"
const stamp = Date.now()

const base: SDKAssistantMessage = {
  id: MID,
  sessionID: SID,
  role: "assistant",
  parentID: "tool-activity-user-message",
  time: { created: stamp - 12000, completed: stamp - 1000 },
  modelID: "anthropic/claude-sonnet-4-6",
  providerID: "kilo",
  mode: "default",
  agent: "default",
  path: { cwd: "/project", root: "/project" },
  cost: 0.004,
  tokens: { total: 1420, input: 900, output: 520, reasoning: 0, cache: { read: 0, write: 0 } },
}

function completed(input: Record<string, unknown>, title: string, output: string): ToolPart["state"] {
  return {
    status: "completed",
    input,
    output,
    title,
    metadata: {},
    time: { start: stamp - 9000, end: stamp - 8600 },
  }
}

function tool(id: string, name: string, state: ToolPart["state"]): ToolPart {
  return { id, sessionID: SID, messageID: MID, type: "tool", callID: `${id}-call`, tool: name, state }
}

function read(id: string, path: string): ToolPart {
  return tool(id, "read", completed({ filePath: path }, path.split("/").pop() ?? path, `// contents of ${path}`))
}

function grep(id: string, pattern: string): ToolPart {
  return tool(id, "grep", completed({ pattern }, pattern, `src/app.ts:42: ${pattern}`))
}

function think(id: string, text: string): ReasoningPart {
  return {
    id,
    sessionID: SID,
    messageID: MID,
    type: "reasoning",
    text,
    time: { start: stamp - 11000, end: stamp - 10400 },
  }
}

function say(id: string, text: string): TextPart {
  return { id, sessionID: SID, messageID: MID, type: "text", text }
}

/** The screenshot case: two thoughts around three reads and one search. */
const explore: SDKPart[] = [
  think("activity-think-1", "## Mapping the transcript\nI need to find where assistant parts are rendered."),
  read("activity-read-1", "packages/kilo-vscode/webview-ui/src/components/chat/AssistantMessage.tsx"),
  read("activity-read-2", "packages/kilo-ui/src/components/message-part.tsx"),
  read("activity-read-3", "packages/kilo-ui/src/components/context-tool-results.tsx"),
  grep("activity-grep-1", 'data-component="tool-part-wrapper"'),
  think("activity-think-2", "## Confirming the render path\nThe sidebar renders every part flat."),
  say("activity-text-1", "The sidebar renders assistant parts as a flat list, one card per tool call."),
]

/** More steps than the chip stack holds, so the `+N` chip appears. */
const overflow: SDKPart[] = [
  think("overflow-think-1", "Planning the change."),
  read("overflow-read-1", "src/index.ts"),
  grep("overflow-grep-1", "createSignal"),
  tool("overflow-list-1", "list", completed({ path: "src/components" }, "components", "chat/\nshared/")),
  tool("overflow-bash-1", "bash", completed({ command: "bun test", description: "Run tests" }, "Run tests", "12 pass")),
  tool(
    "overflow-write-1",
    "write",
    completed({ filePath: "src/app.ts", content: "export const app = 1\n" }, "app.ts", ""),
  ),
  tool("overflow-fetch-1", "webfetch", completed({ url: "https://example.com" }, "example.com", "# Example")),
  say("overflow-text-1", "Done."),
]

/** A live tail changes the summary but never opens the detail list itself. */
const streaming: SDKPart[] = [
  think("stream-think-1", "Looking for the failing test."),
  read("stream-read-1", "tests/unit/tool-activity.test.ts"),
  grep("stream-grep-1", "expect\\("),
  tool("stream-bash-1", "bash", {
    status: "running",
    input: { command: "bun test tests/unit", description: "Run the unit tests" },
    title: "Run the unit tests",
    metadata: {},
    time: { start: stamp - 2000 },
  }),
]

/** A live run whose active step is a search, to check the shimmer on a long label. */
const searching: SDKPart[] = [
  think("live-think-1", "Working out where the renderer lives."),
  read("live-read-1", "src/components/chat/AssistantMessage.tsx"),
  read("live-read-2", "src/components/chat/TranscriptRow.tsx"),
  tool("live-grep-1", "grep", {
    status: "running",
    input: { pattern: "tool-part-wrapper" },
    title: "tool-part-wrapper",
    metadata: {},
    time: { start: stamp - 1200 },
  }),
]

/** Repeated MCP calls stay one step; a different MCP tool starts another. */
const mcp: SDKPart[] = [
  tool("mcp-a-1", "linear_search_issues", completed({ query: "transcript" }, "transcript", "3 issues")),
  tool("mcp-b-1", "linear_get_issue", completed({ id: "KILO-1" }, "KILO-1", "Issue body")),
  tool("mcp-b-2", "linear_get_issue", completed({ id: "KILO-2" }, "KILO-2", "Issue body")),
  say("mcp-text-1", "Both issues describe the same transcript density problem."),
]

const Activity: Component<{ id: string; parts: SDKPart[]; live?: boolean }> = (props) => {
  const [open, setOpen] = createSignal(false)
  const items = () =>
    props.parts
      .filter((part) => part.type === "reasoning" || part.type === "tool")
      .map((part) => ({ key: part.id, message: base as never, part: part as never }))
  return (
    <ToolActivityGroup
      groupKey={props.id}
      items={items()}
      live={props.live === true}
      open={open()}
      cascade
      onOpenChange={setOpen}
      onCascade={() => undefined}
      render={(item) => <AssistantMessage message={base} parts={[item().part as SDKPart]} activityDetail />}
    />
  )
}

const css = `
.tool-activity-lab {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 460px;
}

.tool-activity-lab-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
}

.tool-activity-lab-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}
`

const cases: { name: string; parts: SDKPart[]; live?: boolean }[] = [
  { name: "Exploration run", parts: explore },
  { name: "Overflow stack", parts: overflow },
  { name: "Running tail", parts: streaming, live: true },
  { name: "Live search", parts: searching, live: true },
  { name: "Repeated MCP tools", parts: mcp },
]

const meta = {
  title: "Chat/Compact Tool Activity",
  parameters: { layout: "padded" },
  args: { compact: true, comparison: false },
  argTypes: {
    compact: {
      name: "Compact tool activity",
      description: "The experimental kilo-code.new.experimental.compactToolActivity flag.",
      control: { type: "boolean" },
    },
    comparison: {
      name: "Show flat comparison",
      description: "Render the same parts again with the flag off.",
      control: { type: "boolean" },
    },
  },
} satisfies Meta<{ compact: boolean; comparison: boolean }>

export default meta

type Story = StoryObj<typeof meta>

export const Groups: Story = {
  name: "Activity Groups",
  render: (args: { compact: boolean; comparison: boolean }) => (
    <StoryProviders noPadding sessionID={SID} status="idle">
      <SessionContext.Provider value={mockSessionValue({ id: SID, status: "idle" }) as never}>
        <style>{css}</style>
        <div class="tool-activity-lab">
          <For each={cases}>
            {(item) => (
              <section class="tool-activity-lab-panel">
                <span class="tool-activity-lab-title">{item.name}</span>
                <div class="vscode-session-turn-assistant">
                  <Show when={args.compact} fallback={<AssistantMessage message={base} parts={item.parts} />}>
                    <Activity id={item.name} parts={item.parts} live={item.live} />
                  </Show>
                </div>
                <Show when={args.comparison}>
                  <span class="tool-activity-lab-title">{item.name} · flag off</span>
                  <div class="vscode-session-turn-assistant">
                    <AssistantMessage message={base} parts={item.parts} />
                  </div>
                </Show>
              </section>
            )}
          </For>
        </div>
      </SessionContext.Provider>
    </StoryProviders>
  ),
}
