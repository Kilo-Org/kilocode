// kilocode_change - new file
export const SESSION_ID = "ses_0000000000001"

export const userMessage = (index: number) => ({
  id: `msg_${index.toString().padStart(12, "0")}`,
  sessionID: SESSION_ID,
  role: "user",
  time: { created: 1000 + index },
  agent: "build",
  model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
})

export const assistantMessage = (index: number) => ({
  id: `msg_${index.toString().padStart(12, "0")}`,
  sessionID: SESSION_ID,
  role: "assistant",
  time: { created: 1000 + index },
  parentID: `msg_${(index - 1).toString().padStart(12, "0")}`,
  modelID: "claude-sonnet-4-5",
  providerID: "anthropic",
  mode: "build",
  agent: "build",
  path: { cwd: "/tmp", root: "/tmp" },
  cost: 0.01,
  tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
})

export const textPart = (messageID: string, index: number) => ({
  id: `prt_${index.toString().padStart(12, "0")}`,
  sessionID: SESSION_ID,
  messageID,
  type: "text",
  text: "hello",
})

export const toolPart = (messageID: string, index: number) => ({
  id: `prt_${index.toString().padStart(12, "0")}`,
  sessionID: SESSION_ID,
  messageID,
  type: "tool",
  callID: `call_${index}`,
  tool: "bash",
  state: { status: "completed", input: {}, output: "done", title: "bash", metadata: {}, time: { start: 1, end: 2 } },
})

/**
 * A two-message document whose second message carries a `completed` tool part with
 * no `state.title`, which is not a valid `ToolStateCompleted` (issue #44 shape).
 *
 * Used to prove the whole document is rejected during pre-flight validation, before
 * any row is written.
 */
export const malformedToolPartDocument = () => [
  { info: userMessage(1), parts: [textPart("msg_000000000001", 1)] },
  {
    info: assistantMessage(2),
    parts: [
      {
        ...toolPart("msg_000000000002", 2),
        state: { status: "completed", input: {}, output: "done", metadata: {}, time: { start: 1, end: 2 } },
      },
    ],
  },
]
