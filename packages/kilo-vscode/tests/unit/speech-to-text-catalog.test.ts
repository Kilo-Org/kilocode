import { describe, expect, it } from "bun:test"
import { parseSpeechToTextCatalog } from "../../src/speech-to-text/catalog"
import { DEFAULT_SPEECH_TO_TEXT_MODEL } from "../../src/speech-to-text/models"

describe("speech-to-text discovery", () => {
  it("keeps transcription catalog metadata authoritative and exposes additions", () => {
    const models = parseSpeechToTextCatalog([
      {
        id: "fish-audio/transcribe-1",
        name: "Fish Audio: Transcribe 1",
      },
      {
        id: "openai/gpt-4o-mini-transcribe",
        name: "OpenAI: GPT-4o Mini Transcribe",
      },
      {
        id: "openai/whisper-1",
        name: "Whisper 1",
      },
    ])

    expect(models).toEqual([
      { id: "fish-audio/transcribe-1", label: "Transcribe 1", provider: "Fish Audio" },
      {
        id: "openai/gpt-4o-mini-transcribe",
        label: "GPT-4o Mini Transcribe",
        provider: "OpenAI",
      },
      { id: "openai/whisper-1", label: "Whisper 1", provider: "openai" },
    ])
  })

  it("rejects empty or malformed catalogs so callers can use the static fallback", () => {
    expect(parseSpeechToTextCatalog([])).toBeUndefined()
    expect(parseSpeechToTextCatalog({ data: [] })).toBeUndefined()
    expect(DEFAULT_SPEECH_TO_TEXT_MODEL.id).toBe("openai/whisper-large-v3-turbo")
  })
})
