/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import type {
  AssistantMessage as SDKAssistantMessage,
  Part as SDKPart,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@kilocode/sdk/v2"
import { StoryProviders, defaultMockData } from "./StoryProviders"
import { AssistantMessage } from "../components/chat/AssistantMessage"
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
import type { QuestionRequest, SuggestionRequest } from "../types/messages"
import { writeToolOpen } from "../../../../kilo-ui/src/components/tool-open-state"

registerVscodeToolOverrides()

const SID = "tool-call-lab-session"
const MID = "tool-call-lab-message"
const stamp = Date.now()

const base: SDKAssistantMessage = {
  id: MID,
  sessionID: SID,
  role: "assistant",
  parentID: "tool-call-lab-user-message",
  time: { created: stamp - 9000, completed: stamp - 1000 },
  modelID: "anthropic/claude-sonnet-4-6",
  providerID: "kilo",
  mode: "default",
  agent: "default",
  path: { cwd: "/project", root: "/project" },
  cost: 0.0021,
  tokens: { total: 742, input: 386, output: 356, reasoning: 0, cache: { read: 0, write: 0 } },
}

const hits = [
  'packages/kilo-ui/src/components/message-part.tsx:1847: <div data-component="tool-output">',
  'packages/kilo-ui/src/components/basic-tool.css:250: [data-component="tool-output"]',
  "packages/kilo-vscode/webview-ui/src/components/chat/VscodeToolOverrides.tsx:141: background process output",
].join("\n")

const proc = [
  "pid: 48122",
  "status: running",
  "cwd: /project",
  "command: bun run --cwd packages/kilo-vscode storybook",
  "last_output:",
  "Storybook 9.0.18 for solid-vite started",
  "Local: http://localhost:6007/",
].join("\n")

function completed(input: Record<string, unknown>, title: string, value: string): ToolPart["state"] {
  return {
    status: "completed",
    input,
    output: value,
    title,
    metadata: {},
    time: { start: stamp - 5000, end: stamp - 4400 },
  }
}

function failed(input: Record<string, unknown>, value: string): ToolPart["state"] {
  return {
    status: "error",
    input,
    error: value,
    metadata: {},
    time: { start: stamp - 3600, end: stamp - 3400 },
  }
}

function tool(id: string, call: string, name: string, state: ToolPart["state"]): ToolPart {
  return {
    id,
    sessionID: SID,
    messageID: MID,
    type: "tool",
    callID: call,
    tool: name,
    state,
  }
}

function text(id: string, value: string): TextPart {
  return {
    id,
    sessionID: SID,
    messageID: MID,
    type: "text",
    text: value,
  }
}

function reasoning(id: string, value: string): ReasoningPart {
  return {
    id,
    sessionID: SID,
    messageID: MID,
    type: "reasoning",
    text: value,
    time: { start: stamp - 6800, end: stamp - 6200 },
  }
}

function bash(id: string, call: string, description: string, command: string, output: string): ToolPart {
  return tool(id, call, "bash", completed({ description, command }, description, output))
}

const gapPatch = [
  "===================================================================",
  "--- packages/kilo-ui/src/components/message-part.css",
  "+++ packages/kilo-ui/src/components/message-part.css",
  "@@ -560,5 +560,5 @@",
  ' html[data-theme="kilo-vscode"] [data-component="reasoning-part"] {',
  '   [data-component="collapsible"].tool-collapsible {',
  "-    gap: 4px;",
  "+    gap: 8px;",
  "   }",
  " }",
].join("\n")

const writePatch = [
  "===================================================================",
  "--- packages/kilo-vscode/webview-ui/src/stories/tool-call-lab.stories.tsx",
  "+++ packages/kilo-vscode/webview-ui/src/stories/tool-call-lab.stories.tsx",
  "@@ -1,3 +1,4 @@",
  " /** @jsxImportSource solid-js */",
  ' import { For } from "solid-js"',
  ' import type { Meta, StoryObj } from "storybook-solidjs-vite"',
  '+import { AssistantMessage } from "../components/chat/AssistantMessage"',
].join("\n")

const blockQuestions: QuestionRequest[] = [
  {
    id: "matrix-question-request",
    sessionID: SID,
    questions: [
      {
        question: "Which visual family should this new block follow?",
        header: "Block Style",
        options: [
          { label: "Tool row", description: "Compact header with dark expanded output" },
          { label: "Inline card", description: "Standalone VS Code prompt-style card" },
        ],
      },
    ],
    tool: { messageID: MID, callID: "matrix-call-question-active" },
  },
]

const blockSuggestions: SuggestionRequest[] = [
  {
    id: "matrix-suggestion-request",
    sessionID: SID,
    text: "Run a local visual review after checking this block matrix.",
    actions: [
      { label: "Review UI", prompt: "/review uncommitted" },
      { label: "Open Storybook", prompt: "Inspect the Tool Call Lab Block Matrix story" },
    ],
    tool: { messageID: MID, callID: "matrix-call-suggest-active" },
  },
]

const blocks: SDKPart[] = [
  text("matrix-text-intro", "Block matrix rendered through the real VS Code AssistantMessage path."),
  reasoning(
    "matrix-reasoning-open",
    "**Reasoning output**\n\nThis should use the same trigger-to-output gap and expanded width as regular tool calls.",
  ),
  bash(
    "matrix-bash",
    "matrix-call-bash",
    "Run visual check",
    "bun run --cwd packages/kilo-vscode build-storybook",
    ["storybook v10.2.10", "info => Output directory: storybook-static", "success Built Storybook in 4.2s"].join("\n"),
  ),
  tool(
    "matrix-grep",
    "matrix-call-grep",
    "grep",
    completed(
      { pattern: "tool-collapsible", include: "*.css", path: "packages/kilo-ui/src/components" },
      "Find gaps",
      hits,
    ),
  ),
  tool(
    "matrix-background-start",
    "matrix-call-background-start",
    "background_process",
    completed(
      {
        action: "start",
        command: "bun run --cwd packages/kilo-vscode storybook",
        description: "Start Storybook",
        ready: { port: 6007, pattern: "Local:", timeout: 30000 },
        workdir: "/project",
      },
      "Start Storybook",
      proc,
    ),
  ),
  tool("matrix-edit", "matrix-call-edit", "edit", {
    status: "completed",
    input: {
      filePath: "packages/kilo-ui/src/components/message-part.css",
      oldString: "gap: 4px;",
      newString: "gap: 8px;",
    },
    output: "",
    title: "Edit reasoning gap",
    metadata: {
      filediff: {
        file: "packages/kilo-ui/src/components/message-part.css",
        patch: gapPatch,
        additions: 1,
        deletions: 1,
      },
    },
    time: { start: stamp - 3300, end: stamp - 3100 },
  }),
  tool("matrix-write", "matrix-call-write", "write", {
    status: "completed",
    input: {
      filePath: "packages/kilo-vscode/webview-ui/src/stories/tool-call-lab.stories.tsx",
      content: "export const SearchPreviews = {}",
    },
    output: "",
    title: "Write story fixture",
    metadata: {
      filediff: {
        file: "packages/kilo-vscode/webview-ui/src/stories/tool-call-lab.stories.tsx",
        patch: writePatch,
        additions: 1,
        deletions: 0,
      },
    },
    time: { start: stamp - 3000, end: stamp - 2800 },
  }),
  tool("matrix-todos", "matrix-call-todos", "todowrite", {
    status: "completed",
    input: {
      todos: [
        { id: "todo-1", content: "Add block matrix story", status: "completed" },
        { id: "todo-2", content: "Check spacing against reasoning output", status: "in_progress" },
        { id: "todo-3", content: "Run visual regression", status: "pending" },
      ],
    },
    output: "",
    title: "Update todos",
    metadata: {},
    time: { start: stamp - 2300, end: stamp - 2100 },
  }),
  tool("matrix-patch", "matrix-call-patch", "apply_patch", {
    status: "completed",
    input: {},
    output: "",
    title: "Patch two files",
    metadata: {
      files: [
        {
          filePath: "/project/packages/kilo-ui/src/components/message-part.css",
          relativePath: "packages/kilo-ui/src/components/message-part.css",
          type: "update",
          patch: gapPatch,
          diff: gapPatch,
          additions: 1,
          deletions: 1,
        },
        {
          filePath: "/project/packages/kilo-vscode/webview-ui/src/stories/tool-call-lab.stories.tsx",
          relativePath: "packages/kilo-vscode/webview-ui/src/stories/tool-call-lab.stories.tsx",
          type: "update",
          patch: writePatch,
          diff: writePatch,
          additions: 1,
          deletions: 0,
        },
      ],
    },
    time: { start: stamp - 2700, end: stamp - 2400 },
  }),
  tool("matrix-question-active", "matrix-call-question-active", "question", {
    status: "running",
    input: { questions: blockQuestions[0].questions },
    title: "Ask design question",
    metadata: {},
    time: { start: stamp - 2000 },
  }),
  tool("matrix-suggest-active", "matrix-call-suggest-active", "suggest", {
    status: "running",
    input: { text: blockSuggestions[0].text, actions: blockSuggestions[0].actions },
    title: "Suggest follow-up",
    metadata: {},
    time: { start: stamp - 1900 },
  }),
  tool("matrix-plan-exit", "matrix-call-plan-exit", "plan_exit", {
    status: "completed",
    input: { path: "docs/plans/tool-call-polish.md" },
    output: "",
    title: "Plan ready",
    metadata: { plan: "/project/docs/plans/tool-call-polish.md" },
    time: { start: stamp - 1800, end: stamp - 1700 },
  }),
  tool("matrix-mcp", "matrix-call-mcp", "linear_search_documentation", {
    status: "completed",
    input: { query: "Linear attachments", page: 1 },
    output:
      '## Linear attachments\n\nUse uploaded asset URLs to create issue attachments.\n\n```json\n{\n  "status": "ready"\n}\n```',
    title: "Search docs",
    metadata: {},
    time: { start: stamp - 1600, end: stamp - 1400 },
  }),
  tool(
    "matrix-tool-hint",
    "matrix-call-tool-hint",
    "edit",
    failed({ filePath: "packages/kilo-ui/src/components/message-part.css" }, "oldString and newString are identical"),
  ),
  tool(
    "matrix-tool-error",
    "matrix-call-tool-error",
    "github-pr-search",
    failed({ query: "tool call preview" }, "GitHub API error: 401 Unauthorized"),
  ),
]

const data = {
  ...defaultMockData,
  message: { [SID]: [base] },
  part: { [MID]: blocks },
}

for (const key of [
  "grep:matrix-call-grep",
  "edit:matrix-call-edit",
  "write:matrix-call-write",
  "apply_patch:matrix-call-patch",
  "todowrite:matrix-call-todos",
  "linear_search_documentation:matrix-call-mcp",
]) {
  writeToolOpen(key, true)
}

const css = `
.tool-call-lab-search-previews {
  box-sizing: border-box;
  width: min(1180px, 100%);
  padding: 16px;
}

.tool-call-lab-search-previews * {
  box-sizing: border-box;
}

.tool-call-lab-header {
  margin-bottom: 14px;
  color: var(--vscode-foreground, var(--text-base));
}

.tool-call-lab-title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
}

.tool-call-lab-subtitle {
  margin: 0;
  max-width: 760px;
  color: var(--vscode-descriptionForeground, var(--text-weak));
  font-size: 12px;
  line-height: 18px;
}

.tool-call-lab-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
  align-items: start;
}

.tool-call-lab-panel {
  min-width: 0;
  border: 1px solid var(--vscode-panel-border, var(--border-weak-base));
  background: color-mix(in srgb, var(--vscode-sideBar-background, var(--surface-base)) 96%, transparent);
}

.tool-call-lab-panel-wide {
  max-width: 780px;
}

.tool-call-lab-panel-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--vscode-panel-border, var(--border-weak-base));
}

.tool-call-lab-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground, var(--text-base));
}

.tool-call-lab-panel-note {
  font-size: 11px;
  line-height: 16px;
  color: var(--vscode-descriptionForeground, var(--text-weak));
}

.tool-call-lab-stack {
  padding: 12px;
}
`

const meta: Meta = {
  title: "Labs/Tool Call Lab",
  parameters: { layout: "padded" },
}

export default meta

type Story = StoryObj

export const SearchPreviews: Story = {
  name: "Block Matrix",
  render: () => (
    <StoryProviders
      data={data}
      noPadding
      onOpenDiff={() => undefined}
      onOpenFile={() => undefined}
      questions={blockQuestions}
      sessionID={SID}
      status="busy"
      suggestions={blockSuggestions}
    >
      <style>{css}</style>
      <div class="tool-call-lab-search-previews">
        <div class="tool-call-lab-header">
          <p class="tool-call-lab-title">Assistant block matrix</p>
          <p class="tool-call-lab-subtitle">
            Real VS Code AssistantMessage rendering for the block families that can appear between assistant text and
            tool output: reasoning, shell, search previews, background processes, diffs, todos, active prompts, plan
            exits, MCP output, hints, and errors.
          </p>
        </div>
        <section class="tool-call-lab-panel tool-call-lab-panel-wide">
          <div class="tool-call-lab-panel-header">
            <span class="tool-call-lab-panel-title">Real assistant path</span>
            <span class="tool-call-lab-panel-note">
              Uses AssistantMessage instead of raw Part so VS Code-only cards and overrides are included.
            </span>
          </div>
          <div class="tool-call-lab-stack">
            <div class="vscode-session-turn-assistant">
              <AssistantMessage message={base} parts={blocks} />
            </div>
          </div>
        </section>
      </div>
    </StoryProviders>
  ),
}
