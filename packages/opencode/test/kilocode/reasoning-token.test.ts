import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import * as ReasoningToken from "../../src/kilocode/reasoning-token"
import * as LLMAISDK from "../../src/session/llm/ai-sdk"

describe("reasoning token filtering", () => {
  test.each([
    "<｜end▁of▁thinking｜>",
    "<|end_of_thinking|>",
    "<｜end of thinking｜>",
    "</think>",
  ])("strips %s from the text boundary", (marker) => {
    const state = new Map()
    expect(ReasoningToken.filter(state, "text", `${marker}answer`)).toBe("answer")
  })

  test("preserves marker text after visible content starts", () => {
    const state = new Map()
    expect(ReasoningToken.filter(state, "text", "Document </think> literally.")).toBe("Document </think> literally.")
  })

  test("handles provider IDs that match object prototype keys", () => {
    const state = new Map()
    expect(ReasoningToken.filter(state, "constructor", "answer")).toBe("answer")
  })

  test("deletes completed state so reused IDs filter markers", () => {
    const state = new Map()
    expect(ReasoningToken.filter(state, "text", "answer")).toBe("answer")
    expect(ReasoningToken.filter(state, "text", "", true)).toBe("")
    expect(state.has("text")).toBe(false)
    expect(ReasoningToken.filter(state, "text", "</think>next")).toBe("next")
  })

  test("strips a marker split across streaming deltas", async () => {
    const state = LLMAISDK.adapterState()
    const chunks = [
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "<｜end▁" },
      { type: "text-delta", id: "text", text: "of▁thinking｜>answer" },
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

  test("flushes an ordinary partial tag before propagating a stream error", async () => {
    const state = LLMAISDK.adapterState()
    const error = new Error("stream failed")
    const events: unknown[] = []
    await Effect.runPromise(LLMAISDK.toLLMEvents(state, { type: "text-start", id: "text" }))
    await Effect.runPromise(LLMAISDK.toLLMEvents(state, { type: "text-delta", id: "text", text: "<" }))

    const stream = LLMAISDK.toLLMStream(state, { type: "error", error }).pipe(
      Stream.runForEach((event) => Effect.sync(() => events.push(event))),
    )
    expect(Effect.runPromise(stream)).rejects.toBe(error)
    expect(events).toMatchObject([{ type: "text-delta", id: "text", text: "<" }])
  })

  test.each(["text-end", "abort", "finish"] as const)("flushes an ordinary partial tag on %s", async (type) => {
    const state = LLMAISDK.adapterState()
    type Event = Parameters<typeof LLMAISDK.toLLMEvents>[1]
    const terminal = {
      "text-end": { type: "text-end", id: "text" },
      abort: { type: "abort" },
      finish: {
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: {},
      },
    }[type] as Event
    const chunks = [
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "<" },
      terminal,
    ] as const
    const events = await Effect.runPromise(
      Effect.forEach(chunks, (chunk) => LLMAISDK.toLLMEvents(state, chunk)).pipe(
        Effect.map((items) => items.flat()),
      ),
    )

    expect(events.slice(0, 2)).toMatchObject([
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", text: "<" },
    ])
  })
})
