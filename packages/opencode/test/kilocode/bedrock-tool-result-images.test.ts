import { expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { Provider } from "../../src/provider/provider"

const sessionID = SessionID.make("ses_bedrock_tool_image")
const providerID = ProviderV2.ID.make("amazon-bedrock")
const png = "iVBORw0KGgo="

const bedrock = (id: string) =>
  ({
    id: ModelV2.ID.make(id),
    providerID,
    api: { id, url: "", npm: "@ai-sdk/amazon-bedrock" },
  }) as Provider.Model

const base = (messageID: string, id: string) => ({
  id: PartID.make(id),
  sessionID,
  messageID: MessageID.make(messageID),
})

// The read tool returned a PNG; the next request replays that tool result.
const history = (model: Provider.Model): SessionV1.WithParts[] => {
  const userID = MessageID.make("msg_user")
  const assistantID = MessageID.make("msg_assistant")
  return [
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
      parts: [{ ...base(userID, "prt_user"), type: "text", text: "describe red.png" }],
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
        agent: "code",
        path: { cwd: "/", root: "/" },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      } as SessionV1.Assistant,
      parts: [
        {
          ...base(assistantID, "prt_read"),
          type: "tool",
          tool: "read",
          callID: "call_read",
          state: {
            status: "completed",
            input: { filePath: "red.png" },
            output: "Image read successfully",
            title: "red.png",
            metadata: {},
            time: { start: 0, end: 1 },
            attachments: [
              {
                ...base(assistantID, "prt_png"),
                type: "file",
                mime: "image/png",
                filename: "red.png",
                url: `data:image/png;base64,${png}`,
              },
            ],
          },
        },
      ] as SessionV1.Part[],
    },
  ]
}

test.each(["us.openai.gpt-6-astra", "global.openai.gpt-6-sol"])(
  "sends a Bedrock %s tool-result image as a user message",
  async (id) => {
    const messages = await MessageV2.toModelMessages(history(bedrock(id)), bedrock(id))
    expect(messages.map((msg) => msg.role)).toEqual(["user", "assistant", "tool", "user"])
    expect(messages[2].content).toMatchObject([{ output: { type: "text", value: "Image read successfully" } }])
    expect(messages[3].content).toContainEqual({
      type: "file",
      mediaType: "image/png",
      filename: "red.png",
      data: `data:image/png;base64,${png}`,
    })
  },
)

test.each([
  "global.anthropic.claude-sonnet-4-6",
  "us.amazon.nova-pro-v1:0",
  "us.meta.llama4-maverick-17b-instruct-v1:0",
])("keeps a Bedrock %s tool-result image in the tool result", async (id) => {
  const messages = await MessageV2.toModelMessages(history(bedrock(id)), bedrock(id))
  expect(messages.map((msg) => msg.role)).toEqual(["user", "assistant", "tool"])
  expect(messages[2].content).toMatchObject([
    {
      output: {
        type: "content",
        value: [
          { type: "text", text: "Image read successfully" },
          { type: "media", mediaType: "image/png", data: png },
        ],
      },
    },
  ])
})
