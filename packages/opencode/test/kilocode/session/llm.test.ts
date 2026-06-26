import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { STREAM_IDLE_TIMEOUT_MS, streamTimeout } from "@/kilocode/provider/provider"
import { KiloLLM } from "@/kilocode/session/llm"

describe("kilocode.session.llm.timeout", () => {
  test("uses the prepared request timeout", () => {
    const result = KiloLLM.timeout({
      options: { chunkTimeout: 15_000 },
    })

    expect(result).toEqual({ timeout: { chunkMs: 15_000 } })
  })

  test("ignores invalid prepared values", () => {
    const result = KiloLLM.timeout({
      options: { chunkTimeout: "15_000" },
    })

    expect(result).toEqual({})
  })

  test("omits the AI SDK timeout when it is not configured", () => {
    expect(KiloLLM.timeout({ options: {} })).toEqual({})
  })

  test("allows the AI SDK timeout to be disabled explicitly", () => {
    expect(KiloLLM.timeout({ options: { chunkTimeout: 0 } })).toEqual({})
  })
})

describe("kilocode.provider.streamTimeout", () => {
  test("uses the default stream inactivity timeout", () => {
    expect(streamTimeout({ options: {}, defaultMs: STREAM_IDLE_TIMEOUT_MS })).toBe(120_000)
  })

  test("prefers an explicit timeout over the default", () => {
    expect(streamTimeout({ options: { chunkTimeout: 30_000 }, defaultMs: STREAM_IDLE_TIMEOUT_MS })).toBe(30_000)
  })

  test("allows the default timeout to be disabled", () => {
    expect(streamTimeout({ options: { chunkTimeout: 0 }, defaultMs: STREAM_IDLE_TIMEOUT_MS })).toBeUndefined()
  })
})

describe("kilocode.session.llm.text", () => {
  test("joins text delta events", async () => {
    const out = await Effect.runPromise(
      KiloLLM.text(
        Stream.make(
          LLMEvent.textDelta({ id: "text", text: "hello " }),
          LLMEvent.textDelta({ id: "text", text: "world" }),
        ),
      ),
    )

    expect(out).toBe("hello world")
  })

  test("fails on stream errors after partial text", async () => {
    const err = new Error("provider unavailable")
    const text = KiloLLM.text(
      Stream.concat(Stream.make(LLMEvent.textDelta({ id: "text", text: "partial" })), Stream.fail(err)),
    )

    await expect(Effect.runPromise(text)).rejects.toThrow("provider unavailable")
  })

  test("fails on stream interruption", async () => {
    const text = KiloLLM.text(Stream.fail(new DOMException("Aborted", "AbortError")))

    await expect(Effect.runPromise(text)).rejects.toMatchObject({ name: "AbortError" })
  })
})
