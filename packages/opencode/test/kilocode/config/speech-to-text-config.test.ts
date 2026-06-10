import { describe, expect, test } from "bun:test"
import { Config } from "../../../src/config/config"
import { Schema } from "effect"

describe("Config.Info experimental speech-to-text model", () => {
  test("parses the selected speech-to-text model", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({
      experimental: {
        speech_to_text_model: "openai/gpt-4o-mini-transcribe",
      },
    })

    expect(parsed.experimental?.speech_to_text_model).toBe("openai/gpt-4o-mini-transcribe")
  })

  test("keeps existing experimental defaults", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({ experimental: { speech_to_text_model: "google/chirp-3" } })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })
})
