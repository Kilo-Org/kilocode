import { describe, expect, test } from "bun:test"
import type { ModelMessage } from "ai"
import { ProviderTransform } from "../../src/provider/transform"

const model = (npm: string, providerID: string) =>
  ({
    id: `${providerID}/gemini-3.8-flash`,
    providerID,
    api: {
      id: "gemini-3.8-flash",
      url: "https://generativelanguage.googleapis.com",
      npm,
    },
    name: "Gemini 3.8 Flash",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 1_000_000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  }) as any

const user: ModelMessage = { role: "user", content: "Check the merge queue" }
const call: ModelMessage = {
  role: "assistant",
  content: [{ type: "tool-call", toolCallId: "call_1", toolName: "bash", input: { command: "gh run list" } }],
}
const result: ModelMessage = {
  role: "tool",
  content: [{ type: "tool-result", toolCallId: "call_1", toolName: "bash", output: { type: "text", value: "ok" } }],
}
const thought: ModelMessage = {
  role: "assistant",
  content: [{ type: "reasoning", text: "**Reviewing Merge Queue Status**\n\nAll checks are green so far." }],
}
const answer: ModelMessage = { role: "assistant", content: [{ type: "text", text: "All checks passed." }] }
const primed: ModelMessage = { role: "user", content: "Continue." }

// Gemini rejects any request whose contents end with a model turn:
// 400 INVALID_ARGUMENT "Requests ending with a model turn are not supported."
describe("ProviderTransform.message - gemini trailing model turn", () => {
  const gemini = model("@ai-sdk/google", "google")

  test("drops a reasoning-only assistant tail", () => {
    const out = ProviderTransform.message([user, call, result, thought], gemini, {})
    expect(out).toEqual([user, call, result])
  })

  test("primes a user turn behind a text assistant tail", () => {
    const out = ProviderTransform.message([user, answer], gemini, {})
    expect(out).toEqual([user, answer, primed])
  })

  test("drops a reasoning-only tail and still primes behind the text tail underneath", () => {
    const out = ProviderTransform.message([user, answer, thought], gemini, {})
    expect(out).toEqual([user, answer, primed])
  })

  test("leaves requests that end with a user or tool turn alone", () => {
    expect(ProviderTransform.message([user, call, result], gemini, {})).toEqual([user, call, result])
    expect(ProviderTransform.message([user], gemini, {})).toEqual([user])
  })

  test("applies to gemini on vertex", () => {
    const vertex = model("@ai-sdk/google-vertex", "google-vertex")
    expect(ProviderTransform.message([user, call, result, thought], vertex, {})).toEqual([user, call, result])
  })

  test("keeps assistant prefill for other providers", () => {
    const anthropic = {
      ...model("@ai-sdk/anthropic", "anthropic"),
      id: "anthropic/claude-sonnet-4-5",
      api: { id: "claude-sonnet-4-5", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    }
    const out = ProviderTransform.message([user, answer, thought], anthropic, {})
    expect(out.map((msg) => msg.role)).toEqual(["user", "assistant", "assistant"])
  })
})
