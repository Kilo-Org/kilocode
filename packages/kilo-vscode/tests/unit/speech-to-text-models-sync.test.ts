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

  it("includes NVIDIA Parakeet without prompt conditioning", () => {
    const model = getSpeechToTextModel("nvidia/parakeet-tdt-0.6b-v3")

    expect(model).toMatchObject({
      id: "nvidia/parakeet-tdt-0.6b-v3",
      label: "Parakeet TDT 0.6B v3",
      provider: "NVIDIA",
    })
    expect(model.verbatim).toBeUndefined()
  })
})
