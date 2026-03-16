/** @jsxImportSource solid-js */
/**
 * Stories for high-priority chat components:
 * ChatView, MessageList, QuestionDock, TaskHeader
 *
 * These render with mocked session/server/provider contexts — the components
 * will show their "idle / empty" states since no real extension host is connected.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders, mockSessionValue } from "./StoryProviders"
import { ChatView } from "../components/chat/ChatView"
import { TaskHeader } from "../components/chat/TaskHeader"
import { QuestionDock } from "../components/chat/QuestionDock"
import { SessionContext } from "../context/session"
import type { QuestionRequest, TodoItem } from "../types/messages"

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
      totalCost: () => 0.0012,
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

// ---------------------------------------------------------------------------
// QuestionDock stories
// ---------------------------------------------------------------------------

export const QuestionDockSingle: Story = {
  name: "QuestionDock — single question",
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

// ---------------------------------------------------------------------------
// TaskHeader with todos
// ---------------------------------------------------------------------------

const mockTodosInProgress: TodoItem[] = [
  { id: "1", content: "Create a haiku about Jan", status: "completed" },
  { id: "2", content: "Create a poem about Henk", status: "in_progress" },
  { id: "3", content: "Write a limerick about the team", status: "pending" },
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
      messages: () => [{ id: "msg-001" }] as any[],
      currentSession: () => ({
        id: SESSION_ID,
        title: "Writing poems about the team",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      todos: () => mockTodosInProgress,
    }
    return (
      <StoryProviders sessionID={SESSION_ID} status="busy" noPadding>
        <SessionContext.Provider value={session as any}>
          <div style={{ width: "380px" }}>
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
