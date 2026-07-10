import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as ReasoningToken from "../../src/kilocode/reasoning-token"
import * as LLMAISDK from "../../src/session/llm/ai-sdk"

describe("reasoning token filtering", () => {
  test.each([
    "<｜end▁of▁thinking｜>",
    "<|end_of_thinking|>",
    "<｜end of thinking｜>",
    "</think>",
  ])("strips %s from text", (marker) => {
    const state = {}
    expect(ReasoningToken.filter(state, "text", `answer${marker}`, true)).toBe("answer")
  })

  test("strips a marker split across streaming deltas", async () => {
    const state = LLMAISDK.adapterState()
    const chunks = [
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "answer<｜end▁" },
      { type: "text-delta", id: "text", text: "of▁thinking｜>" },
      { type: "text-end", id: "text" },
    ] as const
    const events = await Effect.runPromise(
      Effect.forEach(chunks, (chunk) => LLMAISDK.toLLMEvents(state, chunk)).pipe(
        Effect.map((items) => items.flat()),
      ),
    )

    expect(events).toMatchObject([
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "answer" },
      { type: "text-end", id: "text" },
    ])
  })

  test("flushes an ordinary partial tag when text ends", async () => {
    const state = LLMAISDK.adapterState()
    const chunks = [
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "answer<" },
      { type: "text-end", id: "text" },
    ] as const
    const events = await Effect.runPromise(
      Effect.forEach(chunks, (chunk) => LLMAISDK.toLLMEvents(state, chunk)).pipe(
        Effect.map((items) => items.flat()),
      ),
    )

    expect(events).toMatchObject([
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "answer" },
      { type: "text-delta", id: "text", text: "<" },
      { type: "text-end", id: "text" },
    ])
  })
})
