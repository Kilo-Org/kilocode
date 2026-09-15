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

  test("parses a custom transcription source", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({
      experimental: {
        speech_to_text_base_url: "https://api.openai.com/v1",
        speech_to_text_api_key: "sk-test",
      },
    })

    expect(parsed.experimental?.speech_to_text_base_url).toBe("https://api.openai.com/v1")
    expect(parsed.experimental?.speech_to_text_api_key).toBe("sk-test")
  })

  test("keeps existing experimental defaults", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({ experimental: { speech_to_text_model: "google/chirp-3" } })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })
})
