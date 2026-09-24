import { expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"

const png = "iVBORw0KGgo="

// The read tool returned a PNG; the next request replays that tool result (only the fields the conversion needs).
const history = [
  {
    info: { id: "msg_assistant", role: "assistant" },
    parts: [
      {
        type: "tool",
        tool: "read",
        callID: "call_read",
        state: {
          status: "completed",
          input: { filePath: "red.png" },
          output: "Image read successfully",
          metadata: {},
          time: { start: 0, end: 1 },
          attachments: [{ type: "file", mime: "image/png", filename: "red.png", url: `data:image/png;base64,${png}` }],
        },
      },
    ],
  },
] as unknown as SessionV1.WithParts[]

const convert = (id: string) =>
  MessageV2.toModelMessages(history, {
    id,
    providerID: "amazon-bedrock",
    api: { id, url: "", npm: "@ai-sdk/amazon-bedrock" },
  } as unknown as Provider.Model)

test.each(["us.openai.gpt-6-astra", "global.openai.gpt-6-sol"])(
  "sends a Bedrock %s tool-result image as a user message",
  async (id) => {
    const messages = await convert(id)
    expect(messages.map((msg) => msg.role)).toEqual(["assistant", "tool", "user"])
    expect(messages[1].content).toMatchObject([{ output: { type: "text", value: "Image read successfully" } }])
    expect(messages[2].content).toContainEqual({
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
  const messages = await convert(id)
  expect(messages.map((msg) => msg.role)).toEqual(["assistant", "tool"])
  expect(messages[1].content).toMatchObject([
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
