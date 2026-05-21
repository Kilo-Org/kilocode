import { describe, expect, it } from "bun:test"
import {
  canUseSpeechToText,
  selectedSpeechToTextModel,
} from "../../webview-ui/src/components/speech-to-text/availability"
import { DEFAULT_SPEECH_TO_TEXT_MODEL } from "../../src/speech-to-text/models"

describe("speech-to-text config availability", () => {
  const providers = ["kilo"]
  const profile = {}

  it("enables speech input from resolved config when Kilo access exists", () => {
    expect(canUseSpeechToText({ experimental: { speech_to_text: true } }, providers, profile)).toBe(true)
  })

  it("hides speech input when the config flag is false or unset", () => {
    expect(canUseSpeechToText({ experimental: { speech_to_text: false } }, providers, profile)).toBe(false)
    expect(canUseSpeechToText({}, providers, profile)).toBe(false)
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
