/** @jsxImportSource solid-js */
/**
 * Stories for high-priority chat components:
 * ChatView, MessageList, QuestionDock
 *
 * These render with mocked session/server/provider contexts — the components
 * will show their "idle / empty" states since no real extension host is connected.
 */

import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { ChatView } from "../components/chat/ChatView"
import { QuestionDock } from "../components/chat/QuestionDock"
import type { QuestionRequest } from "../types/messages"

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
  parameters: { layout: "padded" },
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
      <div style={{ width: "420px", height: "600px", display: "flex", "flex-direction": "column" }}>
        <ChatView />
      </div>
    </StoryProviders>
  ),
}

// ---------------------------------------------------------------------------
// QuestionDock stories
// ---------------------------------------------------------------------------

export const QuestionDockSingle: Story = {
  name: "QuestionDock — single question",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} questions={[singleQuestion]}>
      <div style={{ width: "420px" }}>
        <QuestionDock request={singleQuestion} />
      </div>
    </StoryProviders>
  ),
}

export const QuestionDockMulti: Story = {
  name: "QuestionDock — multi-question wizard",
  render: () => (
    <StoryProviders sessionID={SESSION_ID} questions={[multiQuestion]}>
      <div style={{ width: "420px" }}>
        <QuestionDock request={multiQuestion} />
      </div>
    </StoryProviders>
  ),
}
