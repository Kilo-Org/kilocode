import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { LLMEvent } from "@opencode-ai/llm"
import { KiloLLM } from "@/kilocode/session/llm"

describe("kilocode.session.llm.timeout", () => {
  test("uses prepared options before the provider fallback", () => {
    const result = KiloLLM.timeout({
      options: { chunkTimeout: 15_000 },
      fallback: { chunkTimeout: 30_000 },
    })

    expect(result).toEqual({ timeout: { chunkMs: 15_000 } })
  })

  test("uses the provider fallback when prepared options omit the timeout", () => {
    const result = KiloLLM.timeout({
      options: {},
      fallback: { chunkTimeout: 30_000 },
    })

    expect(result).toEqual({ timeout: { chunkMs: 30_000 } })
  })

  test("uses the provider fallback when the prepared value is not a number", () => {
    const result = KiloLLM.timeout({
      options: { chunkTimeout: "15_000" },
      fallback: { chunkTimeout: 30_000 },
    })

    expect(result).toEqual({ timeout: { chunkMs: 30_000 } })
  })

  test("defaults the chunk idle timeout to 60_000 ms when no override is configured", () => {
    expect(KiloLLM.timeout({ options: {} })).toEqual({ timeout: { chunkMs: 60_000 } })
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
