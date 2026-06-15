import { describe, expect, it } from "bun:test"
import {
  canUseSpeechToText,
  selectedSpeechToTextModel,
} from "../../webview-ui/src/components/speech-to-text/availability"
import { DEFAULT_SPEECH_TO_TEXT_MODEL } from "../../src/speech-to-text/models"

describe("speech-to-text availability", () => {
  const providers = ["kilo"]
  const profile = {}

  it("shows speech input by default when Kilo access exists", () => {
    expect(canUseSpeechToText({}, providers, profile)).toBe(true)
  })

  it("hides speech input without a signed-in, enabled Kilo provider", () => {
    expect(canUseSpeechToText({}, [], profile)).toBe(false)
    expect(canUseSpeechToText({}, providers, null)).toBe(false)
    expect(canUseSpeechToText({ disabled_providers: ["kilo"] }, providers, profile)).toBe(false)
  })

  it("normalizes configured and unknown transcription models", () => {
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_model: "google/chirp-3" } })).toBe(
      "google/chirp-3",
    )
    expect(selectedSpeechToTextModel({ experimental: { speech_to_text_model: "unknown/model" } })).toBe(
      DEFAULT_SPEECH_TO_TEXT_MODEL.id,
    )
  })
})
