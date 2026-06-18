import { describe, expect, it } from "bun:test"
import {
  DEFAULT_SPEECH_TO_TEXT_MODEL,
  SPEECH_TO_TEXT_MODELS,
  getSpeechToTextModel,
} from "../../src/speech-to-text/models"

describe("speech-to-text model catalog", () => {
  it("uses Whisper Large V3 Turbo as the fallback default", () => {
    expect(DEFAULT_SPEECH_TO_TEXT_MODEL.id).toBe("openai/whisper-large-v3-turbo")
    expect(DEFAULT_SPEECH_TO_TEXT_MODEL.id).toBe(SPEECH_TO_TEXT_MODELS[0]?.id)
  })

  it("falls back from unknown config model IDs", () => {
    expect(getSpeechToTextModel("unknown/model")).toBe(DEFAULT_SPEECH_TO_TEXT_MODEL)
  })
})
