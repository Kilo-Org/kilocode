/** @jsxImportSource solid-js */
import { createEffect, createSignal, For } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import type {
  AssistantMessage as SDKAssistantMessage,
  Part as SDKPart,
  ReasoningPart,
  TextPart,
  ToolPart,
} from "@kilocode/sdk/v2"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { AssistantMessage } from "../components/chat/AssistantMessage"
import { ErrorDisplay } from "../components/chat/ErrorDisplay"
import { PermissionDock } from "../components/chat/PermissionDock"
import { QuestionDock } from "../components/chat/QuestionDock"
import { RevertBanner } from "../components/chat/RevertBanner"
import { StartupErrorBanner } from "../components/chat/StartupErrorBanner"
import { SuggestBar } from "../components/chat/SuggestBar"
import { registerExpandedTaskTool } from "../components/chat/TaskToolExpanded"
import { TranscriptRowView } from "../components/chat/TranscriptRow"
import { registerVscodeToolOverrides } from "../components/chat/VscodeToolOverrides"
import { TurnOutcome } from "../components/shared/TurnOutcome"
import { WorkingIndicator } from "../components/shared/WorkingIndicator"
import { ServerContext } from "../context/server"
import { SessionContext } from "../context/session"
import type { TranscriptDiffRow } from "../context/transcript-rows"
import type { PermissionRequest, QuestionRequest, SuggestionRequest } from "../types/messages"
import { writeToolOpen } from "../../../../kilo-ui/src/components/tool-open-state"

registerExpandedTaskTool()
registerVscodeToolOverrides()

const SID = "tool-call-lab-session"
const MID = "tool-call-lab-message"
const CHILD = "tool-call-lab-explore-child"
const RUNNING = "tool-call-lab-running-child"
const STARTING = "tool-call-lab-starting-child"
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

function completed(
  input: Record<string, unknown>,
  title: string,
  value: string,
  metadata: Record<string, unknown> = {},
): ToolPart["state"] {
  return {
    status: "completed",
    input,
    output: value,
    title,
    metadata,
    time: { start: stamp - 5000, end: stamp - 4400 },
  }
}

function running(
  input: Record<string, unknown>,
  title: string,
  metadata: Record<string, unknown> = {},
): ToolPart["state"] {
  return {
    status: "running",
    input,
    title,
    metadata,
    time: { start: stamp - 5000 },
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

function done(
  id: string,
  name: string,
  input: Record<string, unknown>,
  title: string,
  output = "",
  metadata: Record<string, unknown> = {},
) {
  return tool(`matrix-${id}`, `matrix-call-${id}`, name, completed(input, title, output, metadata))
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

const standaloneQuestion: QuestionRequest = {
  id: "matrix-question-standalone",
  sessionID: SID,
  questions: [
    {
      question: "Which targets should this review include?",
      header: "Targets",
      multiple: true,
      custom: true,
      options: [
        { label: "CLI", description: "Core agent runtime" },
        { label: "VS Code", description: "Extension webview" },
      ],
    },
  ],
}

const failedSuggestion: SuggestionRequest = {
  id: "matrix-suggestion-failed",
  sessionID: SID,
  text: "Re-run the failed visual review.",
  actions: [{ label: "Retry review", prompt: "/local-review-uncommitted" }],
}

const genericError: NonNullable<SDKAssistantMessage["error"]> = {
  name: "UnknownError",
  data: { message: "Provider request failed before the assistant could finish." },
}

const paidError: NonNullable<SDKAssistantMessage["error"]> = {
  name: "APIError",
  data: {
    message: "Unauthorized",
    statusCode: 401,
    isRetryable: false,
    responseBody: '{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}',
  },
}

const limitError: NonNullable<SDKAssistantMessage["error"]> = {
  name: "APIError",
  data: {
    message: "Promotion limit reached",
    statusCode: 429,
    isRetryable: false,
    responseBody: '{"error":{"code":"PROMOTION_MODEL_LIMIT_REACHED"}}',
  },
}

const server = {
  connectionState: () => "connected" as const,
  serverInfo: () => undefined,
  extensionVersion: () => "7.3.50",
  errorMessage: () => undefined,
  errorDetails: () => undefined,
  isConnected: () => true,
  profileData: () => null,
  deviceAuth: () => ({ status: "idle" as const }),
  startLogin: () => undefined,
  goToLogin: () => undefined,
  vscodeLanguage: () => "en",
  languageOverride: () => undefined,
  workspaceDirectory: () => "/project",
  gitInstalled: () => true,
}

const diff: TranscriptDiffRow = {
  type: "diff",
  key: "matrix-diff",
  turn: "matrix-turn",
  partial: false,
  queued: false,
  live: false,
  message: {
    id: "matrix-diff-message",
    sessionID: SID,
    role: "assistant",
    createdAt: "2026-06-21T12:00:00.000Z",
  },
  diffs: [
    { file: "src/app.ts", before: "", after: "", additions: 4, deletions: 1, status: "modified" },
    { file: "src/theme.css", before: "", after: "", additions: 8, deletions: 0, status: "added" },
  ],
}

const permissions: PermissionRequest[] = [
  {
    id: "matrix-permission-bash",
    sessionID: SID,
    toolName: "bash",
    patterns: ["bun test"],
    always: ["bun *"],
    args: {
      command: "bun test packages/kilo-vscode/tests/unit",
      description: "Run extension unit tests",
      rules: ["bun *", "bun test *"],
    },
    tool: { messageID: MID, callID: "matrix-call-permission-bash" },
  },
  {
    id: "matrix-permission-edit",
    sessionID: SID,
    toolName: "edit",
    patterns: ["packages/kilo-ui/src/components/message-part.css"],
    always: ["packages/kilo-ui/src/components/*"],
    args: {
      filediff: {
        file: "packages/kilo-ui/src/components/message-part.css",
        patch: gapPatch,
        additions: 1,
        deletions: 1,
      },
    },
    tool: { messageID: MID, callID: "matrix-call-permission-edit" },
  },
  {
    id: "matrix-permission-child",
    sessionID: CHILD,
    toolName: "bash",
    patterns: ["git status"],
    always: ["git status *"],
    args: { command: "git status", rules: ["git *", "git status"] },
    tool: { messageID: "matrix-task-child-message", callID: "matrix-call-permission-child" },
  },
]

const blocks: SDKPart[] = [
  reasoning(
    "matrix-reasoning-open",
    "**Reasoning output**\n\nThis uses the same production renderer as reasoning shown during an agent turn.",
  ),
  bash(
    "matrix-bash",
    "matrix-call-bash",
    "Run visual check",
    "bun run --cwd packages/kilo-vscode build-storybook",
    ["storybook v10.2.10", "info => Output directory: storybook-static", "success Built Storybook in 4.2s"].join("\n"),
  ),
  done(
    "bash-truncated",
    "bash",
    { command: "bun test", description: "Run test suite" },
    "Run test suite",
    "Output truncated. Open the complete output in an editor.",
    { outputPath: "/tmp/kilo-tool-output.log" },
  ),
  done(
    "read",
    "read",
    { filePath: "packages/kilo-ui/src/components/message-part.tsx", offset: 1788, limit: 80 },
    "Read tool renderers",
  ),
  done(
    "glob",
    "glob",
    { pattern: "webview-ui/src/**/*.tsx", path: "packages/kilo-vscode" },
    "Find webview files",
    [
      "packages/kilo-vscode/webview-ui/src/components/chat/AssistantMessage.tsx",
      "packages/kilo-vscode/webview-ui/src/components/chat/QuestionDock.tsx",
    ].join("\n"),
  ),
  done(
    "grep",
    "grep",
    { pattern: "tool-collapsible", include: "*.css", path: "packages/kilo-ui/src/components" },
    "Find gaps",
    hits,
  ),
  done(
    "webfetch",
    "webfetch",
    { url: "https://storybook.js.org/docs", format: "markdown" },
    "Fetch Storybook docs",
    "# Storybook documentation\n\nBuild and test UI components in isolation.",
  ),
  done(
    "websearch",
    "websearch",
    { query: "Storybook visual regression testing", numResults: 3, livecrawl: "fallback", type: "auto" },
    "Search the web",
    "https://storybook.js.org/docs/writing-tests/visual-testing\nhttps://playwright.dev/docs/test-snapshots",
    { provider: "exa" },
  ),
  done(
    "skill",
    "skill",
    { name: "vscode-visual-regression" },
    "Load visual regression skill",
    '<skill_content name="vscode-visual-regression">Storybook workflow loaded.</skill_content>',
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
      diagnostics: {
        "/project/packages/kilo-ui/src/components/message-part.css": [
          {
            severity: 2,
            message: "Verify spacing token consistency",
            range: { start: { line: 562, character: 4 }, end: { line: 562, character: 11 } },
          },
        ],
      },
    },
    time: { start: stamp - 3300, end: stamp - 3100 },
  }),
  done(
    "write-content",
    "write",
    {
      filePath: "packages/kilo-vscode/webview-ui/src/stories/tool-call-lab.stories.tsx",
      content: "export const BlockMatrix = {}",
    },
    "Write raw story content",
    "Wrote story fixture",
  ),
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
  tool("matrix-patch", "matrix-call-patch", "apply_patch", {
    status: "completed",
    input: {
      patchText:
        "*** Begin Patch\n*** Update File: packages/kilo-ui/src/components/message-part.css\n@@\n-gap: 4px;\n+gap: 8px;\n*** End Patch",
    },
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
  done(
    "patch-operations",
    "apply_patch",
    {
      patchText: [
        "*** Begin Patch",
        "*** Add File: src/new.ts",
        "+export const ready = true",
        "*** Delete File: src/old.ts",
        "*** Update File: src/move.ts",
        "*** Move to: src/moved.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
    },
    "Add, delete, and move files",
    "Done!",
    {
      files: [
        {
          filePath: "/project/src/new.ts",
          relativePath: "src/new.ts",
          type: "add",
          diff: "+export const ready = true",
          additions: 1,
          deletions: 0,
        },
        {
          filePath: "/project/src/old.ts",
          relativePath: "src/old.ts",
          type: "delete",
          diff: "-export const old = true",
          additions: 0,
          deletions: 1,
        },
        {
          filePath: "/project/src/move.ts",
          relativePath: "src/move.ts",
          type: "move",
          movePath: "src/moved.ts",
          diff: "-old\n+new",
          additions: 1,
          deletions: 1,
        },
      ],
    },
  ),
  done(
    "todos",
    "todowrite",
    {
      todos: [
        { content: "Add block matrix story", status: "completed", priority: "high" },
        { content: "Check spacing against reasoning output", status: "in_progress", priority: "medium" },
        { content: "Run visual regression", status: "pending", priority: "low" },
      ],
    },
    "Update todos",
    "Updated 3 todos",
  ),
  done(
    "todos-compact",
    "todowrite",
    {
      todos: [
        { content: "Audit renderers", status: "completed", priority: "high" },
        { content: "Add missing fixtures", status: "in_progress", priority: "high" },
      ],
    },
    "Update todo progress",
    "Updated 2 todos",
    {
      todos: [
        { content: "Audit renderers", status: "completed", priority: "high" },
        { content: "Add missing fixtures", status: "in_progress", priority: "high" },
      ],
      view: {
        mode: "compact",
        todos: [{ content: "Add missing fixtures", status: "in_progress", priority: "high", changed: true }],
        hiddenBefore: 1,
        hiddenAfter: 0,
      },
    },
  ),
  tool("matrix-task-explore", "matrix-call-task-explore", "task", {
    status: "completed",
    input: {
      description: "Audit assistant block coverage",
      prompt: "Trace every user-visible assistant block and report the missing Block Matrix fixtures.",
      subagent_type: "explore",
    },
    output: [
      `task_id: ${CHILD} (for resuming to continue this task if needed)`,
      "",
      "<task_result>",
      "Mapped the production assistant block renderers and their uncovered variants.",
      "</task_result>",
    ].join("\n"),
    title: "Audit assistant block coverage",
    metadata: {
      parentSessionId: SID,
      sessionId: CHILD,
      model: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4-6" },
      truncated: false,
    },
    time: { start: stamp - 4200, end: stamp - 3800 },
  }),
  tool(
    "matrix-task-running",
    "matrix-call-task-running",
    "task",
    running(
      {
        description: "Trace production renderers",
        prompt: "Continue tracing user-visible renderer states.",
        subagent_type: "explore",
      },
      "Trace production renderers",
      { sessionId: RUNNING },
    ),
  ),
  tool(
    "matrix-task-starting",
    "matrix-call-task-starting",
    "task",
    running(
      {
        description: "Inspect renderer states",
        prompt: "Inspect pending and running block states.",
        subagent_type: "explore",
      },
      "Inspect renderer states",
      { sessionId: STARTING },
    ),
  ),
  tool(
    "matrix-background-starting",
    "matrix-call-background-starting",
    "background_process",
    running(
      {
        action: "start",
        command: "bun run dev",
        description: "Start development server",
        workdir: "/project",
      },
      "Start development server",
    ),
  ),
  done(
    "background-start",
    "background_process",
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
  done(
    "background-list",
    "background_process",
    { action: "list" },
    "List background processes",
    "id: bgp-storybook\nstatus: running\ncwd: /project\ncommand: bun run storybook",
    { count: 1 },
  ),
  done(
    "background-status",
    "background_process",
    { action: "status", id: "bgp-storybook" },
    "Check background process",
    "id: bgp-storybook\nstatus: running\npid: 48122\ncwd: /project\ncommand: bun run storybook",
    { processID: "bgp-storybook", status: "running" },
  ),
  done(
    "background-logs",
    "background_process",
    { action: "logs", id: "bgp-storybook" },
    "View background logs",
    "Storybook ready\nLocal: http://localhost:6007",
    { processID: "bgp-storybook", status: "ready" },
  ),
  done(
    "background-stop",
    "background_process",
    { action: "stop", id: "bgp-storybook" },
    "Stop background process",
    "id: bgp-storybook\nstatus: stopped\ncwd: /project\ncommand: bun run storybook",
    { processID: "bgp-storybook", status: "stopped" },
  ),
  done(
    "background-restart",
    "background_process",
    { action: "restart", id: "bgp-storybook" },
    "Restart background process",
    "id: bgp-storybook\nstatus: running\npid: 48123\ncwd: /project\ncommand: bun run storybook",
    { processID: "bgp-storybook", status: "running" },
  ),
  tool(
    "matrix-question-active",
    "matrix-call-question-active",
    "question",
    running({ questions: blockQuestions[0].questions }, "Ask design question"),
  ),
  done(
    "question-answered",
    "question",
    { questions: blockQuestions[0].questions },
    "Question answered",
    'User has answered your questions: "Which visual family should this new block follow?"="Tool row".',
    { answers: [["Tool row"]] },
  ),
  done(
    "question-dismissed",
    "question",
    { questions: blockQuestions[0].questions },
    "Question dismissed",
    "User dismissed the question.",
    { answers: [], dismissed: true },
  ),
  tool(
    "matrix-suggest-active",
    "matrix-call-suggest-active",
    "suggest",
    running({ suggest: blockSuggestions[0].text, actions: blockSuggestions[0].actions }, "Suggest follow-up"),
  ),
  done(
    "suggest-accepted",
    "suggest",
    { suggest: "Run a local review.", actions: [{ label: "Review UI", prompt: "/local-review-uncommitted" }] },
    "Review suggestion accepted",
    "User accepted the suggestion. Run /local-review-uncommitted.",
    { accepted: { label: "Review UI", prompt: "/local-review-uncommitted" }, dismissed: false },
  ),
  done(
    "suggest-dismissed",
    "suggest",
    { suggest: "Run a local review.", actions: [{ label: "Review UI", prompt: "/local-review-uncommitted" }] },
    "Review suggestion dismissed",
    "User dismissed the suggestion.",
    { dismissed: true },
  ),
  done("plan-exit", "plan_exit", { path: "docs/plans/tool-call-polish.md" }, "Plan ready", "", {
    plan: "docs/plans/tool-call-polish.md",
  }),
  done(
    "invalid",
    "invalid",
    { tool: "READ", error: "filePath is required" },
    "Invalid tool arguments",
    "The arguments provided to the tool are invalid: filePath is required",
  ),
  done(
    "task-status",
    "task_status",
    { task_id: CHILD, wait: false },
    "Check subagent status",
    `task_id: ${CHILD}\nstate: running\n\n<task_result>Task is still running.</task_result>`,
    { task_id: CHILD, state: "running", timed_out: false },
  ),
  done(
    "repo-clone",
    "repo_clone",
    { repository: "Kilo-Org/kilocode" },
    "Clone repository",
    "Repository ready: Kilo-Org/kilocode\nStatus: cached\nLocal path: /cache/kilocode",
    { repository: "Kilo-Org/kilocode", status: "cached", localPath: "/cache/kilocode" },
  ),
  done(
    "repo-overview",
    "repo_overview",
    { path: "/project", depth: 2 },
    "Inspect repository",
    "Repository structure:\npackages/\n  kilo-vscode/\n  kilo-ui/",
    { ecosystems: ["TypeScript"], dependency_files: ["package.json"], depth: 2, truncated: false },
  ),
  done(
    "codebase-search",
    "codebase_search",
    { query: "Where is the tool renderer selected?" },
    "Search codebase",
    "### packages/kilo-ui/src/components/message-part.tsx\nThe registry selects a renderer by exact tool ID.",
    { count: 1 },
  ),
  done(
    "semantic-search",
    "semantic_search",
    { query: "tool renderer selection", path: "packages/kilo-ui" },
    "Semantic code search",
    "Found 1 result in packages/kilo-ui/src/components/message-part.tsx",
    {
      results: [
        {
          filePath: "packages/kilo-ui/src/components/message-part.tsx",
          score: 0.92,
          startLine: 1210,
          endLine: 1220,
          codeChunk: "const render = ToolRegistry.render(part.tool)",
        },
      ],
    },
  ),
  done(
    "local-recall",
    "kilo_local_recall",
    { mode: "search", query: "tool renderer", limit: 20 },
    "Search past conversations",
    "- **Tool renderer audit**\n  ID: ses_story | Updated: Today | Dir: /project",
  ),
  done(
    "agent-manager",
    "agent_manager",
    { mode: "local", tasks: [{ name: "Renderer audit", prompt: "Audit the chat renderer." }] },
    "Start Agent Manager task",
    "Requested 1 Agent Manager local session.\nrequest_id: am-story",
    { requestID: "am-story", count: 1 },
  ),
  done(
    "lsp",
    "lsp",
    { operation: "hover", filePath: "src/index.ts", line: 1, character: 1 },
    "Inspect symbol",
    '[{"contents":"function main(): void"}]',
    { result: [{ contents: "function main(): void" }] },
  ),
  done(
    "mcp",
    "linear_search_documentation",
    { query: "Linear attachments", page: 1 },
    "Search Linear docs",
    '## Linear attachments\n\nUse uploaded asset URLs to create issue attachments.\n\n```json\n{\n  "status": "ready"\n}\n```',
  ),
  done("list", "list", { path: "/project/src" }, "List directory", "components/\nindex.ts"),
  done(
    "codesearch",
    "codesearch",
    { query: "tool renderer selection" },
    "Legacy code search",
    "https://github.com/Kilo-Org/kilocode/blob/main/packages/kilo-ui/src/components/message-part.tsx",
  ),
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
  tool(
    "matrix-tool-error-long",
    "matrix-call-tool-error-long",
    "webfetch",
    failed(
      { url: "https://example.com" },
      "The remote documentation service could not complete this request after multiple attempts. Check the network connection and retry.",
    ),
  ),
]

function children(id: string): ToolPart[] {
  return Array.from({ length: 45 }, (_, index) => {
    const grep = index % 4 === 1
    const name = grep ? "grep" : "read"
    const input = grep
      ? { pattern: `timeout: ${index}|timeout: [0-9]+.*delayed|delayedBodyServer`, path: "packages" }
      : { filePath: `packages/opencode/test/provider/provider-${index + 1}.test.ts` }
    return {
      id: `matrix-task-${id}-${index}`,
      sessionID: id,
      messageID: `matrix-task-${id}-message`,
      type: "tool",
      callID: `matrix-task-${id}-call-${index}`,
      tool: name,
      state: completed(input, grep ? "Search provider tests" : "Read provider test", grep ? hits : ""),
    }
  })
}

const child = children(CHILD)
const active = children(RUNNING)

const data = {
  ...defaultMockData,
  message: { [SID]: [base], [CHILD]: [], [RUNNING]: [], [STARTING]: [] },
  part: { [MID]: blocks },
}

for (const key of [
  "glob:matrix-call-glob",
  "grep:matrix-call-grep",
  "task:matrix-call-task-explore",
  "task:matrix-task-explore",
  "task:matrix-call-task-running",
  "task:matrix-task-running",
  "task:matrix-call-task-starting",
  "task:matrix-task-starting",
  "edit:matrix-call-edit",
  "write:matrix-call-write",
  "write:matrix-call-write-content",
  "apply_patch:matrix-call-patch",
  "apply_patch:matrix-call-patch-operations",
  "todowrite:matrix-call-todos",
  "todowrite:matrix-call-todos-compact",
  "background_process:matrix-call-background-starting",
  "background_process:matrix-call-background-start",
  "background_process:matrix-call-background-list",
  "background_process:matrix-call-background-status",
  "background_process:matrix-call-background-logs",
  "background_process:matrix-call-background-stop",
  "background_process:matrix-call-background-restart",
  "question:matrix-call-question-answered",
  "question:matrix-call-question-dismissed",
  "suggest:matrix-call-suggest-accepted",
  "suggest:matrix-call-suggest-dismissed",
  "invalid:matrix-call-invalid",
  "task_status:matrix-call-task-status",
  "repo_clone:matrix-call-repo-clone",
  "repo_overview:matrix-call-repo-overview",
  "codebase_search:matrix-call-codebase-search",
  "semantic_search:matrix-call-semantic-search",
  "kilo_local_recall:matrix-call-local-recall",
  "agent_manager:matrix-call-agent-manager",
  "lsp:matrix-call-lsp",
  "linear_search_documentation:matrix-call-mcp",
  "list:matrix-call-list",
  "codesearch:matrix-call-codesearch",
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
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px;
}

.tool-call-lab-panel + .tool-call-lab-panel {
  margin-top: 16px;
}

.tool-call-lab-example {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-call-lab-example-label {
  color: var(--vscode-descriptionForeground, var(--text-weak));
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
`

const meta = {
  title: "Labs/Tool Call Lab",
  parameters: { layout: "padded" },
  args: { toolState: "expanded" },
  argTypes: {
    toolState: {
      name: "Tool call state",
      description: "Expand or collapse every tool call in the Block Matrix.",
      control: { type: "inline-radio" },
      options: ["expanded", "collapsed"],
    },
  },
} satisfies Meta<{ toolState: "expanded" | "collapsed" }>

export default meta

type Story = StoryObj<typeof meta>

export const SearchPreviews: Story = {
  name: "Block Matrix",
  render: (args: { toolState: "expanded" | "collapsed" }) => {
    const [version, setVersion] = createSignal(1)
    createEffect(() => {
      const open = args.toolState === "expanded"
      for (const part of blocks) {
        if (part.type !== "tool") continue
        writeToolOpen(`${part.tool}:${part.callID}`, open)
        writeToolOpen(`${part.tool}:${part.id}`, open)
      }
      setVersion((value) => value + 1)
    })
    const session = {
      ...mockSessionValue({
        id: SID,
        permissions,
        questions: [...blockQuestions, standaloneQuestion],
        status: "busy",
        suggestions: [...blockSuggestions, failedSuggestion],
      }),
      getSessionToolParts: (id: string) => (id === CHILD ? child : id === RUNNING ? active : []),
      getSessionToolCount: (id: string) => (id === CHILD ? child.length : id === RUNNING ? active.length : 0),
      scopedPermissions: () => permissions,
      suggestionErrors: () => new Set([failedSuggestion.id]),
    }
    const retry = {
      ...session,
      busySince: () => undefined,
      permissions: () => [],
      questions: () => [],
      statusInfo: () => ({ type: "retry", attempt: 2, message: "Rate limited", next: 0 }),
      suggestions: () => [],
    }
    const offline = {
      ...retry,
      statusInfo: () => ({ type: "offline", message: "Connection lost. Waiting to reconnect." }),
    }
    const limit = {
      ...session,
      closeReason: () => "completed",
      status: () => "idle",
      visibleMessages: () => [{ ...base, finish: "length" }],
    }
    const filtered = {
      ...limit,
      visibleMessages: () => [{ ...base, finish: "content-filter" }],
    }
    const interrupted = {
      ...limit,
      closeReason: () => "interrupted",
      visibleMessages: () => [base],
    }
    const reverted = {
      ...limit,
      revert: () => ({ messageID: "tool-call-lab-user-message" }),
      revertedCount: () => 2,
      summary: () => ({ diffs: [{ file: "src/app.ts", additions: 4, deletions: 1 }] }),
      userMessages: () => [{ id: "tool-call-lab-user-message" }, { id: "tool-call-lab-user-message-next" }],
    }
    const conversationOnly = {
      ...reverted,
      revert: () => ({ messageID: "tool-call-lab-user-message", workspace: "snapshots-disabled" as const }),
      summary: () => undefined,
    }

    return (
      <StoryProviders
        data={data}
        noPadding
        onOpenDiff={() => undefined}
        onOpenFile={() => undefined}
        permissions={permissions}
        questions={[...blockQuestions, standaloneQuestion]}
        sessionID={SID}
        status="busy"
        suggestions={[...blockSuggestions, failedSuggestion]}
      >
        <SessionContext.Provider value={session as any}>
          <style>{css}</style>
          <div class="tool-call-lab-search-previews">
            <section class="tool-call-lab-panel tool-call-lab-panel-wide">
              <div class="tool-call-lab-stack">
                <div class="vscode-session-turn-assistant">
                  <For each={[version()]}>{() => <AssistantMessage message={base} parts={blocks} />}</For>
                </div>
              </div>
            </section>
            <section class="tool-call-lab-panel tool-call-lab-panel-wide">
              <div class="tool-call-lab-panel-header">
                <span class="tool-call-lab-panel-title">Interactive action surfaces</span>
                <span class="tool-call-lab-panel-note">
                  Permission, question, and suggestion docks rendered with their production components.
                </span>
              </div>
              <div class="tool-call-lab-stack">
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Turn diff summary</span>
                  <ServerContext.Provider value={server as any}>
                    <TranscriptRowView row={diff} />
                  </ServerContext.Provider>
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Command permission</span>
                  <PermissionDock request={permissions[0]} responding={false} onDecide={() => undefined} />
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Edit permission with diff</span>
                  <PermissionDock request={permissions[1]} responding={false} onDecide={() => undefined} />
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Subagent permission</span>
                  <PermissionDock request={permissions[2]} responding={false} onDecide={() => undefined} />
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Standalone multi-select question</span>
                  <QuestionDock request={standaloneQuestion} />
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Failed suggestion response</span>
                  <SuggestBar request={failedSuggestion} />
                </div>
              </div>
            </section>
            <section class="tool-call-lab-panel tool-call-lab-panel-wide">
              <div class="tool-call-lab-panel-header">
                <span class="tool-call-lab-panel-title">Session status and recovery</span>
                <span class="tool-call-lab-panel-note">
                  Retry, offline, revert, startup failure, and abnormal terminal outcomes.
                </span>
              </div>
              <div class="tool-call-lab-stack">
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Retry countdown</span>
                  <SessionContext.Provider value={retry as any}>
                    <WorkingIndicator />
                  </SessionContext.Provider>
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Offline recovery</span>
                  <SessionContext.Provider value={offline as any}>
                    <WorkingIndicator />
                  </SessionContext.Provider>
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Reverted messages</span>
                  <SessionContext.Provider value={reverted as any}>
                    <RevertBanner />
                  </SessionContext.Provider>
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Conversation-only revert</span>
                  <SessionContext.Provider value={conversationOnly as any}>
                    <RevertBanner />
                  </SessionContext.Provider>
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Token limit outcome</span>
                  <SessionContext.Provider value={limit as any}>
                    <TurnOutcome />
                  </SessionContext.Provider>
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Content-filtered outcome</span>
                  <SessionContext.Provider value={filtered as any}>
                    <TurnOutcome />
                  </SessionContext.Provider>
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Interrupted outcome</span>
                  <SessionContext.Provider value={interrupted as any}>
                    <TurnOutcome />
                  </SessionContext.Provider>
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">CLI startup failure</span>
                  <StartupErrorBanner
                    errorMessage="Failed to start the Kilo CLI"
                    errorDetails="spawn /path/to/kilo ENOENT"
                  />
                </div>
              </div>
            </section>
            <section class="tool-call-lab-panel tool-call-lab-panel-wide">
              <div class="tool-call-lab-panel-header">
                <span class="tool-call-lab-panel-title">Assistant error families</span>
                <span class="tool-call-lab-panel-note">
                  Generic provider errors and Kilo authentication or promotion actions.
                </span>
              </div>
              <div class="tool-call-lab-stack">
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Generic error</span>
                  <ErrorDisplay error={genericError} />
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Paid model authentication</span>
                  <ErrorDisplay error={paidError} onLogin={() => undefined} />
                </div>
                <div class="tool-call-lab-example">
                  <span class="tool-call-lab-example-label">Promotion limit</span>
                  <ErrorDisplay error={limitError} onLogin={() => undefined} />
                </div>
              </div>
            </section>
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}
