import { describe, expect, test } from "bun:test"
import { Config } from "../../../src/config/config"

describe("Config.Info experimental speech-to-text", () => {
  test("parses speech-to-text enablement and model", () => {
    const parsed = Config.Info.zod.parse({
      experimental: {
        speech_to_text: true,
        speech_to_text_model: "openai/gpt-4o-mini-transcribe",
      },
    })

    expect(parsed.experimental?.speech_to_text).toBe(true)
    expect(parsed.experimental?.speech_to_text_model).toBe("openai/gpt-4o-mini-transcribe")
  })

  test("preserves explicit disabled speech-to-text", () => {
    const parsed = Config.Info.zod.parse({ experimental: { speech_to_text: false } })
    expect(parsed.experimental?.speech_to_text).toBe(false)
  })

  test("keeps existing experimental defaults", () => {
    const parsed = Config.Info.zod.parse({ experimental: { speech_to_text: true } })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })
})
