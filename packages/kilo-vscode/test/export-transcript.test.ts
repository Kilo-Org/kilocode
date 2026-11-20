import { describe, expect, it } from "bun:test"
import type {
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionTransferData,
} from "@opencode/client"
import { formatSessionTranscript } from "../src/session-transcript"

const info = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
  id: "ses_123456789",
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  title: "Export test",
  time: { created: 1_000, updated: 2_000 },
  location: { directory: "/repo" },
  ...overrides,
})

const user = (text: string, extra: Partial<SessionMessageUser> = {}): SessionMessageInfo => ({
  id: "msg_user",
  type: "user",
  text,
  time: { created: 1_000 },
  ...extra,
})

const assistant = (content: SessionMessageAssistant["content"]): SessionMessageInfo => ({
  id: "msg_assistant",
  type: "assistant",
  agent: "default",
  model: { id: "model", providerID: "provider" },
  content,
  time: { created: 1_000 },
})

const tool = (name: string): SessionMessageAssistant["content"][number] => ({
  type: "tool",
  id: `tool_${name}`,
  name,
  state: {
    status: "completed",
    input: { path: "secret.ts" },
    content: [{ type: "text", text: "tool output" }],
  },
  time: { created: 1_000 },
})

const transfer = (messages: SessionMessageInfo[], overrides: Partial<SessionInfo> = {}): SessionTransferData => ({
  info: info(overrides),
  messages,
})

describe("formatSessionTranscript", () => {
  it("formats the title, local timestamps, and chronological sections", () => {
    const text = formatSessionTranscript(
      transfer([user("Please export this."), assistant([tool("read"), { type: "text", text: "Saved as Markdown." }])]),
    )

    expect(text).toBe(
      `# Export test\n\n` +
        `**Session ID:** ses_123456789\n` +
        `**Created:** ${new Date(1_000).toLocaleString()}\n` +
        `**Updated:** ${new Date(2_000).toLocaleString()}\n\n` +
        `---\n\n` +
        `## User\n\nPlease export this.\n\n` +
        `---\n\n` +
        `## Assistant\n\n**Tool: read**\n\nSaved as Markdown.\n\n` +
        `---\n\n`,
    )
  })

  it("omits synthetic messages, internal messages, reasoning, tool data, and attachments", () => {
    const text = formatSessionTranscript(
      transfer([
        user("Visible question", {
          files: [{ data: "aGVsbG8=", mime: "image/png", source: { type: "inline" }, name: "diagram.png" }],
        }),
        { id: "msg_synthetic", type: "synthetic", text: "Synthetic reminder", time: { created: 1_000 } },
        { id: "msg_system", type: "system", text: "System notice", time: { created: 1_000 } },
        {
          id: "msg_shell",
          type: "shell",
          shellID: "sh_1",
          command: "echo shell-only",
          status: "exited",
          output: { output: "shell-only output", cursor: 0, size: 0, truncated: false },
          time: { created: 1_000 },
        },
        assistant([
          { type: "reasoning", text: "Hidden reasoning" },
          tool("read"),
          { type: "text", text: "Visible answer" },
        ]),
      ]),
    )

    expect(text).toContain("## User\n\nVisible question")
    expect(text).toContain("## Assistant\n\n**Tool: read**\n\nVisible answer")
    expect(text).not.toContain("Synthetic reminder")
    expect(text).not.toContain("System notice")
    expect(text).not.toContain("shell-only")
    expect(text).not.toContain("Hidden reasoning")
    expect(text).not.toContain("secret.ts")
    expect(text).not.toContain("tool output")
    expect(text).not.toContain("diagram.png")
  })

  it("keeps active assistant text and tool markers", () => {
    const text = formatSessionTranscript(
      transfer([
        assistant([
          {
            type: "tool",
            id: "tool_bash",
            name: "bash",
            state: { status: "running", input: { command: "echo hi" }, metadata: {} },
            time: { created: 1_000 },
          },
          { type: "text", text: "Working" },
        ]),
      ]),
    )

    expect(text).toContain("**Tool: bash**")
    expect(text).toContain("Working")
  })

  it("keeps an empty session export readable", () => {
    const text = formatSessionTranscript(transfer([], { id: "ses_empty", title: "Empty" }))

    expect(text).toContain("# Empty")
    expect(text).toContain("**Session ID:** ses_empty")
    expect(text).not.toContain("## User")
    expect(text).not.toContain("## Assistant")
    expect(text).toEndWith("---\n\n")
  })

  it("uses the native timestamped fallback for a session without a title", () => {
    const text = formatSessionTranscript(transfer([], { title: undefined }))

    expect(text).toContain(`# New session - ${new Date(1_000).toISOString()}`)
  })
})
