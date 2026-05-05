/** @jsxImportSource solid-js */
/**
 * Stories for high-priority chat components:
 * ChatView, MessageList, QuestionDock, TaskHeader
 *
 * These render with mocked session/server/provider contexts — the components
 * will show their "idle / empty" states since no real extension host is connected.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, defaultMockData, mockSessionValue } from "./StoryProviders"
import { ChatView } from "../components/chat/ChatView"
import { TaskHeader } from "../components/chat/TaskHeader"
import { QuestionDock } from "../components/chat/QuestionDock"
import { SuggestBar } from "../components/chat/SuggestBar"
import { MessageList } from "../components/chat/MessageList"
import { SessionContext } from "../context/session"
import { ServerContext } from "../context/server"
import type { Message, Part, QuestionRequest, SuggestionRequest, TodoItem } from "../types/messages"

const SESSION_ID = "story-session-chat-001"

// ---------------------------------------------------------------------------
// Question fixtures
// ---------------------------------------------------------------------------

const singleQuestion: QuestionRequest = {
  id: "q-single-001",
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
  tool: { messageID: "asst-msg-001", callID: "call-question-001" },
}

const multiQuestion: QuestionRequest = {
  id: "q-multi-001",
  sessionID: SESSION_ID,
  questions: [
    {
      question: "Which testing framework?",
      header: "Step 1 of 2",
      options: [
        { label: "Vitest", description: "Fast, Vite-native" },
        { label: "Jest", description: "Widely adopted" },
        { label: "Bun test", description: "Built-in, zero config" },
      ],
    },
    {
      question: "Should I include coverage reporting?",
      header: "Step 2 of 2",
      options: [
        { label: "Yes, Istanbul", description: "Instrumentation-based" },
        { label: "Yes, V8", description: "Native V8 coverage" },
        { label: "No", description: "Skip coverage" },
      ],
    },
  ],
  tool: { messageID: "asst-msg-001", callID: "call-question-002" },
}

const reviewSuggestion: SuggestionRequest = {
  id: "s-review-001",
  sessionID: SESSION_ID,
  text: "Start a code review of uncommitted changes?",
  actions: [{ label: "Start review", description: "Run a local review now", prompt: "/local-review-uncommitted" }],
  tool: { messageID: "asst-msg-002", callID: "call-suggest-001" },
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "Chat",
  parameters: { layout: "fullscreen" },
}
export default meta
type Story = StoryObj

// ---------------------------------------------------------------------------
// ChatView stories
// ---------------------------------------------------------------------------

export const ChatViewIdle: Story = {
  name: "ChatView — idle (empty)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle">
      <div style={{ width: "100%", height: "600px", display: "flex", "flex-direction": "column" }}>
        <ChatView />
      </div>
    </StoryProviders>
  ),
}

/** ChatView with messages — shows the full-width "New task" button above the prompt */
export const ChatViewWithMessages: Story = {
  name: "ChatView — with messages (shows New Task button)",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
      messages: () => [{ id: "msg-001" }] as any[],
      costBreakdown: () => [{ label: "Parent session", cost: 0.0012 }],
      contextUsage: () => ({ tokens: 512, percentage: 6 }),
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%", height: "200px", display: "flex", "flex-direction": "column" }}>
            <ChatView />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

/**
 * ChatView with a pending question tool call and an empty input.
 *
 * Locks in the fix for the regression where the question tool's pending request
 * caused the Send button to render as a Stop square. The snapshot captures the
 * prompt bar footer — the submit control must be the paper-plane arrow icon,
 * not the filled square Stop icon.
 *
 * If someone re-couples the prompt input to the question tool, this story's
 * baseline PNG will diverge and the visual-regression CI job will fail.
 */
const pendingToolQuestion: QuestionRequest = {
  id: "q-toolcall-001",
  sessionID: SESSION_ID,
  questions: [
    {
      question: "What would you like to do next?",
      header: "Next step",
      options: [
        { label: "Continue", description: "Keep going with the current plan" },
        { label: "Revise", description: "Adjust the approach before continuing" },
      ],
    },
  ],
  tool: { messageID: "asst-q-001", callID: "call-q-001" },
}

export const ChatViewWithPendingQuestionEmptyInput: Story = {
  name: "ChatView — pending question, empty input (submit must be arrow, not square)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="busy" questions={[pendingToolQuestion]}>
      <div style={{ "max-height": "400px", display: "flex", "flex-direction": "column" }}>
        <ChatView />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// QuestionDock stories
// ---------------------------------------------------------------------------

export const QuestionDockSingle: Story = {
  name: "QuestionDock — single question (explicit submit)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} questions={[singleQuestion]}>
      <div style={{ width: "100%" }}>
        <QuestionDock request={singleQuestion} />
      </div>
    </StoryProviders>
  ),
}

export const QuestionDockMulti: Story = {
  name: "QuestionDock — multi-question wizard",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} questions={[multiQuestion]}>
      <div style={{ width: "100%" }}>
        <QuestionDock request={multiQuestion} />
      </div>
    </StoryProviders>
  ),
}

/** Many options to verify the max-height scroll constraint */
const manyOptionsQuestion: QuestionRequest = {
  id: "q-many-001",
  sessionID: SESSION_ID,
  questions: [
    {
      question: "What would you like to work on today?",
      header: "Quick check-in",
      options: [
        { label: "Fix a bug", description: "Debug and resolve an issue in the codebase" },
        { label: "Add a feature", description: "Implement new functionality" },
        { label: "Refactor code", description: "Improve existing code structure or quality" },
        { label: "Write tests", description: "Add or improve test coverage" },
        { label: "Review code", description: "Provide feedback on code changes" },
        { label: "Update docs", description: "Improve documentation" },
        { label: "Performance", description: "Optimize for speed or memory" },
      ],
    },
  ],
}

export const QuestionDockManyOptions: Story = {
  name: "QuestionDock — many options (scrollable)",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} questions={[manyOptionsQuestion]}>
      <div style={{ width: "100%" }}>
        <QuestionDock request={manyOptionsQuestion} />
      </div>
    </StoryProviders>
  ),
}

export const SuggestBarReview: Story = {
  name: "SuggestBar — review suggestion",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} suggestions={[reviewSuggestion]}>
      <div style={{ width: "100%" }}>
        <SuggestBar request={reviewSuggestion} />
      </div>
    </StoryProviders>
  ),
}

const toolUserID = "user-msg-spacing-001"
const toolAssistantID = "asst-msg-spacing-001"
const queuedUserID = "user-msg-spacing-002"
const queuedSecondID = "user-msg-spacing-003"
const toolNow = 1_700_000_000_000
const spacingMessages = [
  {
    id: toolUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: toolNow - 9000 },
  },
  {
    id: queuedUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: toolNow - 1000 },
  },
  {
    id: queuedSecondID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: toolNow - 500 },
  },
  {
    id: toolAssistantID,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: toolUserID,
    time: { created: toolNow - 8000 },
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/project", root: "/project" },
  },
]
const spacingParts = {
  [toolUserID]: [
    {
      id: "part-user-spacing-001",
      sessionID: SESSION_ID,
      messageID: toolUserID,
      type: "text",
      text: "Run a shell command and stop so I can test the spacing.",
    },
  ],
  [toolAssistantID]: [
    {
      id: "part-bash-spacing-001",
      sessionID: SESSION_ID,
      messageID: toolAssistantID,
      type: "tool",
      callID: "call-bash-spacing-001",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "pwd", description: "Print current directory" },
        output: "/Users/marius/Documents/git/kilocode/.kilo/worktrees/zest-kettledrum",
        title: "pwd",
        metadata: {},
        time: { start: toolNow - 7000, end: toolNow - 6500 },
      },
    },
  ],
  [queuedUserID]: [
    {
      id: "part-user-spacing-002",
      sessionID: SESSION_ID,
      messageID: queuedUserID,
      type: "text",
      text: "ok",
    },
  ],
  [queuedSecondID]: [
    {
      id: "part-user-spacing-003",
      sessionID: SESSION_ID,
      messageID: queuedSecondID,
      type: "text",
      text: "and then explain it",
    },
  ],
}
const spacingData = {
  ...defaultMockData,
  message: { [SESSION_ID]: spacingMessages },
  part: spacingParts,
}

export const MessageListToolToQueuedUserSpacing: Story = {
  name: "MessageList — queued users stay at bottom",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy" }),
      messages: () => spacingMessages,
      userMessages: () => spacingMessages.filter((msg) => msg.role === "user"),
    }
    return (
      <StoryProviders data={spacingData} sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ height: "420px", display: "flex", "flex-direction": "column" }}>
            <MessageList />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// MessageList — sub-agent (task tool) to queued user spacing
// Verifies the same vertical gap applies when the last assistant part is a
// sub-agent's expanded task tool, not just a regular tool like bash.
// ---------------------------------------------------------------------------

const subUserID = "user-msg-subagent-spacing-001"
const subAssistantID = "asst-msg-subagent-spacing-001"
const subQueuedUserID = "user-msg-subagent-spacing-002"
const subChildSessionID = "story-session-child-subagent-001"
const subNow = 1_700_000_100_000
const subagentSpacingMessages = [
  {
    id: subUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: subNow - 9000 },
  },
  {
    id: subAssistantID,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: subUserID,
    time: { created: subNow - 8000 },
    modelID: "claude-sonnet-4-20250514",
    providerID: "anthropic",
    mode: "default",
    agent: "default",
    path: { cwd: "/project", root: "/project" },
  },
  {
    id: subQueuedUserID,
    sessionID: SESSION_ID,
    role: "user",
    time: { created: subNow - 1000 },
  },
]
const subagentSpacingParts = {
  [subUserID]: [
    {
      id: "part-user-subagent-spacing-001",
      sessionID: SESSION_ID,
      messageID: subUserID,
      type: "text",
      text: "Delegate a search to a sub-agent so I can test the spacing.",
    },
  ],
  [subAssistantID]: [
    {
      id: "part-task-subagent-spacing-001",
      sessionID: SESSION_ID,
      messageID: subAssistantID,
      type: "tool",
      callID: "call-task-subagent-spacing-001",
      tool: "task",
      state: {
        status: "completed",
        input: { description: "Find auth usage", subagent_type: "explore" },
        output: "done",
        title: "Find auth usage",
        metadata: { sessionId: subChildSessionID },
        time: { start: subNow - 7000, end: subNow - 6500 },
      },
    },
  ],
  [subQueuedUserID]: [
    {
      id: "part-user-subagent-spacing-002",
      sessionID: SESSION_ID,
      messageID: subQueuedUserID,
      type: "text",
      text: "continue",
    },
  ],
}
const subagentSpacingData = {
  ...defaultMockData,
  message: {
    [SESSION_ID]: subagentSpacingMessages,
    [subChildSessionID]: [],
  },
  part: subagentSpacingParts,
}

export const MessageListSubagentToQueuedUserSpacing: Story = {
  name: "MessageList — sub-agent to queued user spacing",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
      messages: () => subagentSpacingMessages,
      userMessages: () => subagentSpacingMessages.filter((msg) => msg.role === "user"),
    }
    return (
      <StoryProviders data={subagentSpacingData} sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ height: "420px", display: "flex", "flex-direction": "column" }}>
            <MessageList />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// TaskHeader with todos
// ---------------------------------------------------------------------------

const headerNow = 1_700_000_000_000
const headerUserID = "user-task-header-001"
const headerAssistantID = "asst-task-header-001"
const headerMessages: Message[] = [
  {
    id: headerUserID,
    sessionID: SESSION_ID,
    role: "user",
    content: "Can you use the update_todo_list tool to create a CLI interface implementation plan?",
    createdAt: new Date(headerNow - 12000).toISOString(),
    time: { created: headerNow - 12000 },
  },
  {
    id: headerAssistantID,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: headerUserID,
    content: "I'll track the CLI interface implementation with a todo list.",
    createdAt: new Date(headerNow - 10000).toISOString(),
    time: { created: headerNow - 10000 },
    modelID: "anthropic/claude-sonnet-4-6",
    providerID: "kilo",
    mode: "default",
    agent: "code",
    path: { cwd: "/project", root: "/project" },
  },
]
const headerParts: Record<string, Part[]> = {
  [headerAssistantID]: [
    {
      id: "part-header-read-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "packages/opencode/src/cli/index.ts" },
        output: "export async function main() { /* existing CLI bootstrap */ }",
        title: "Read CLI entrypoint",
      },
    },
    {
      id: "part-header-text-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "text",
      text: "I found the existing command registration and argument parsing flow.",
    },
    {
      id: "part-header-glob-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "glob",
      state: {
        status: "completed",
        input: { pattern: "packages/opencode/src/**/*.ts" },
        output:
          "packages/opencode/src/cli/index.ts\npackages/opencode/src/command/run.ts\npackages/opencode/src/config/config.ts",
        title: "Find CLI files",
      },
    },
    {
      id: "part-header-edit-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: "packages/opencode/src/cli/index.ts" },
        output: "Updated the command registry to expose the new interface hook.",
        title: "Update CLI registry",
      },
    },
    {
      id: "part-header-bash-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "bun run check-types:webview", description: "Typecheck webview" },
        output: "Checked 1 project. No type errors found.",
        title: "Run typecheck",
      },
    },
    {
      id: "part-header-write-001",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "write",
      state: {
        status: "completed",
        input: { filePath: "packages/opencode/src/cli/interface.ts" },
        output: "Created the CLI interface implementation scaffold.",
        title: "Create interface scaffold",
      },
    },
    {
      id: "part-header-text-002",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "text",
      text: "Next I am wiring the implementation into the existing command path.",
    },
    {
      id: "part-header-bash-002",
      sessionID: SESSION_ID,
      messageID: headerAssistantID,
      type: "tool",
      tool: "bash",
      state: {
        status: "running",
        input: { command: "bun test packages/opencode/test/cli.test.ts", description: "Run CLI tests" },
        title: "Run CLI tests",
      },
    },
  ],
}

const mockTodosInProgress: TodoItem[] = [
  { id: "1", content: "Project setup and architecture backlog", status: "completed" },
  { id: "2", content: "Configuration schema for target jobs", status: "completed" },
  { id: "3", content: "Core scanning logic", status: "completed" },
  { id: "4", content: "Build invocation and error handling", status: "completed" },
  { id: "5", content: "CLI interface implementation", status: "in_progress" },
  { id: "6", content: "Storage layer implementation", status: "pending" },
  { id: "7", content: "Character profiles and prompt types", status: "pending" },
  { id: "8", content: "Local tests and integration tests", status: "pending" },
  { id: "9", content: "Migration guide", status: "pending" },
  { id: "10", content: "Release validation", status: "pending" },
]

const mockTodosAllDone: TodoItem[] = [
  { id: "1", content: "Create a haiku about Jan", status: "completed" },
  { id: "2", content: "Create a poem about Henk", status: "completed" },
]

export const TaskHeaderWithTodos: Story = {
  name: "TaskHeader — with todos (in progress)",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "busy" }),
      messages: () => headerMessages,
      currentSession: () => ({
        id: SESSION_ID,
        title: "Task: Can you use the update_todo_list tool to create a CLI interface implementation?",
        createdAt: new Date(headerNow - 12000).toISOString(),
        updatedAt: new Date(headerNow).toISOString(),
      }),
      todos: () => mockTodosInProgress,
      getParts: (id: string) => headerParts[id] ?? [],
      contextUsage: () => ({ tokens: 34300, percentage: 17 }),
      costBreakdown: () => [{ label: "Session", cost: 0.64 }],
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "100%" }}>
            <TaskHeader />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

export const TaskHeaderWithTodosAllDone: Story = {
  name: "TaskHeader — with todos (all done)",
  render: () => {
    const session = {
      ...mockSessionValue({ id: SESSION_ID, status: "idle" }),
      messages: () => [{ id: "msg-001" }] as any[],
      currentSession: () => ({
        id: SESSION_ID,
        title: "Writing poems about the team",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      todos: () => mockTodosAllDone,
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="idle" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "380px" }}>
            <TaskHeader />
          </div>
        </SessionContext.Provider>
      </StoryProviders>
    )
  },
}

// ---------------------------------------------------------------------------
// Welcome screen with AccountSwitcher + KiloNotifications
// ---------------------------------------------------------------------------

const MOCK_NOTIFICATION = {
  id: "notif-1",
  title: "Try BYOK for Kilo Gateway",
  message: "Bring your own API key for even more flexibility with Kilo Gateway models.",
  action: { actionText: "Learn more", actionURL: "https://kilo.ai/docs" },
}

/** Mock server context with profile data so AccountSwitcher is visible */
const mockServer = {
  connectionState: () => "connected" as const,
  serverInfo: () => undefined,
  extensionVersion: () => "1.0.0",
  errorMessage: () => undefined,
  errorDetails: () => undefined,
  isConnected: () => true,
  profileData: () => ({
    profile: {
      email: "dev@kilo.dev",
      name: "Dev User",
      organizations: [{ id: "org-1", name: "Kilo Org", role: "member" }],
    },
    balance: { balance: 5.0 },
    currentOrgId: "org-1",
  }),
  deviceAuth: () => ({ status: "idle" as const }),
  startLogin: () => {},
  vscodeLanguage: () => "en",
  languageOverride: () => undefined,
  workspaceDirectory: () => "/project",
  gitInstalled: () => true,
}

export const WelcomeWithSwitcherAndNotification: Story = {
  name: "Welcome — account switcher + notification",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} status="idle" noPadding notifications={[MOCK_NOTIFICATION]}>
      <ServerContext.Provider value={mockServer as any}>
        <div style={{ width: "100%", height: "600px", display: "flex", "flex-direction": "column" }}>
          <ChatView />
        </div>
      </ServerContext.Provider>
    </StoryProviders>
  ),
}
