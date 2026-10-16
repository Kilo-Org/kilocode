import { expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageV2 } from "../../src/session/message-v2"
import { KiloPartLifecycle } from "../../src/kilocode/session/part-lifecycle"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { Provider } from "../../src/provider/provider"

const sessionID = SessionID.make("ses_transient")
const providerID = ProviderV2.ID.make("test")
const model: Provider.Model = {
  id: ModelV2.ID.make("test-model"),
  providerID,
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai" },
} as Provider.Model

const base = (messageID: string, id: string) => ({
  id: PartID.make(id),
  sessionID,
  messageID: MessageID.make(messageID),
})

test("does not replay persisted transient snapshot progress", async () => {
  const userID = MessageID.make("msg_user")
  const assistantID = MessageID.make("msg_assistant")
  const input: SessionV1.WithParts[] = [
    {
      info: {
        id: userID,
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: "user",
        model: { providerID, modelID: model.id },
        tools: {},
        mode: "",
      } as SessionV1.User,
      parts: [{ ...base(userID, "prt_user"), type: "text", text: "continue" }],
    },
    {
      info: {
        id: assistantID,
        sessionID,
        role: "assistant",
        parentID: userID,
        time: { created: 0 },
        modelID: model.id,
        providerID,
        mode: "",
        agent: "build",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      } as SessionV1.Assistant,
      parts: [
        {
          ...base(assistantID, "prt_tool"),
          type: "tool",
          tool: "bash",
          callID: "call_bash",
          state: {
            status: "completed",
            input: {},
            output: "changed files",
            title: "bash",
            time: { start: 0, end: 1 },
          },
        },
        {
          ...base(assistantID, "prt_progress"),
          type: "text",
          text: "Initializing snapshot…",
          synthetic: true,
          metadata: { [KiloPartLifecycle.key]: "transient" },
        },
      ] as SessionV1.Part[],
    },
  ]

  const messages = await MessageV2.toModelMessages(input, model)
  expect(JSON.stringify(messages)).not.toContain("Initializing snapshot")
  expect(messages.some((message) => message.role === "tool")).toBe(true)
})
