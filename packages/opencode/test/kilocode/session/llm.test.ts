import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { KiloLLM } from "@/kilocode/session/llm"

describe("kilocode.session.llm.resolveIdleMs", () => {
  test("uses prepared options before the provider fallback", () => {
    expect(
      KiloLLM.resolveIdleMs({
        options: { chunkTimeout: 15_000 },
        fallback: { chunkTimeout: 30_000 },
      }),
    ).toBe(15_000)
  })

  test("uses the provider fallback when prepared options omit the timeout", () => {
    expect(
      KiloLLM.resolveIdleMs({
        options: {},
        fallback: { chunkTimeout: 30_000 },
      }),
    ).toBe(30_000)
  })

  test("uses the provider fallback when the prepared value is not a number", () => {
    expect(
      KiloLLM.resolveIdleMs({
        options: { chunkTimeout: "15_000" },
        fallback: { chunkTimeout: 30_000 },
      }),
    ).toBe(30_000)
  })

  test("defaults the chunk idle timeout to 60_000 ms when no override is configured", () => {
    expect(KiloLLM.resolveIdleMs({ options: {} })).toBe(60_000)
  })

  test("returns undefined when prepared is false (disabled)", () => {
    expect(
      KiloLLM.resolveIdleMs({
        options: { chunkTimeout: false },
        fallback: { chunkTimeout: 30_000 },
      }),
    ).toBeUndefined()
  })

  test("returns undefined when prepared is 0 (internal disable)", () => {
    expect(
      KiloLLM.resolveIdleMs({
        options: { chunkTimeout: 0 },
        fallback: { chunkTimeout: 30_000 },
      }),
    ).toBeUndefined()
  })

  test("returns undefined when provider fallback is false", () => {
    expect(
      KiloLLM.resolveIdleMs({
        options: {},
        fallback: { chunkTimeout: false },
      }),
    ).toBeUndefined()
  })

  test("falls through invalid prepared values to provider fallback", () => {
    expect(
      KiloLLM.resolveIdleMs({
        options: { chunkTimeout: -1 },
        fallback: { chunkTimeout: 5_000 },
      }),
    ).toBe(5_000)
    expect(
      KiloLLM.resolveIdleMs({
        options: { chunkTimeout: Number.POSITIVE_INFINITY },
        fallback: { chunkTimeout: 5_000 },
      }),
    ).toBe(5_000)
    expect(
      KiloLLM.resolveIdleMs({
        options: { chunkTimeout: Number.NaN },
        fallback: { chunkTimeout: 5_000 },
      }),
    ).toBe(5_000)
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
