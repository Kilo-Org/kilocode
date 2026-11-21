import { describe, expect, test } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { KiloMessageV2 } from "@/kilocode/session/message-v2"
import type { Provider } from "@/provider/provider"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID, SessionID } from "@/session/schema"

const sessionID = SessionID.make("session")
const providerID = ProviderV2.ID.make("test")
const model = {
  id: ModelV2.ID.make("test-model"),
  providerID,
  api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai" },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
} as Provider.Model

function assistant(id: string) {
  return {
    id,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: "m-parent",
    modelID: model.api.id,
    providerID: model.providerID,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as SessionV1.Assistant
}

function text(messageID: string, id: string, value: string) {
  return {
    id: PartID.make(`prt_${id}`),
    sessionID,
    messageID: MessageID.make(`msg_${messageID}`),
    type: "text",
    text: value,
  } as SessionV1.Part
}

describe("KiloMessageV2.skipEmptyText", () => {
  const part = (value: string) => text("m", "p", value) as MessageV2.TextPart

  test("skips empty text without signed reasoning", () => {
    expect(KiloMessageV2.skipEmptyText(part(""), false)).toBe(true)
  })

  test("keeps empty text when signed reasoning needs the separator", () => {
    expect(KiloMessageV2.skipEmptyText(part(""), true)).toBe(false)
  })

  test("keeps non-empty text", () => {
    expect(KiloMessageV2.skipEmptyText(part("hi"), false)).toBe(false)
    expect(KiloMessageV2.skipEmptyText(part("hi"), true)).toBe(false)
  })
})

describe("toModelMessages empty assistant text (#16139)", () => {
  test("drops an assistant message that only has an empty text part", async () => {
    const result = await MessageV2.toModelMessages(
      [{ info: assistant("m-only-empty"), parts: [text("m-only-empty", "p1", "")] }],
      model,
    )

    expect(result).toStrictEqual([])
  })

  test("keeps signed-reasoning separator as a single space", async () => {
    const reasoning = {
      id: PartID.make("prt_r1"),
      sessionID,
      messageID: MessageID.make("msg_m-signed"),
      type: "reasoning",
      text: "thinking",
      metadata: { anthropic: { signature: "sig" } },
      time: { start: 0 },
    } as SessionV1.Part
    const result = await MessageV2.toModelMessages(
      [{ info: assistant("m-signed"), parts: [reasoning, text("m-signed", "p2", "")] }],
      model,
    )

    expect(result).toHaveLength(1)
    const texts = (result[0].content as Array<{ type: string; text?: string }>).filter((p) => p.type === "text")
    expect(texts.map((t) => t.text)).toStrictEqual([" "])
  })
})
