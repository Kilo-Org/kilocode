export interface SpeechToTextModelDef {
  readonly id: string
  readonly label: string
  readonly provider: string
}

const models: SpeechToTextModelDef[] = [
  {
    id: "openai/gpt-4o-mini-transcribe",
    label: "GPT-4o Mini Transcribe",
    provider: "OpenAI",
  },
  {
    id: "openai/gpt-4o-transcribe",
    label: "GPT-4o Transcribe",
    provider: "OpenAI",
  },
  {
    id: "openai/whisper-1",
    label: "Whisper 1",
    provider: "OpenAI",
  },
  {
    id: "openai/whisper-large-v3-turbo",
    label: "Whisper Large V3 Turbo",
    provider: "OpenAI-compatible",
  },
  {
    id: "openai/whisper-large-v3",
    label: "Whisper Large V3",
    provider: "OpenAI-compatible",
  },
  {
    id: "google/chirp-3",
    label: "Chirp 3",
    provider: "Google",
  },
]

export const SPEECH_TO_TEXT_MODELS: readonly SpeechToTextModelDef[] = models
export const DEFAULT_SPEECH_TO_TEXT_MODEL: SpeechToTextModelDef = models[0]!

export function getSpeechToTextModel(id: string | undefined): SpeechToTextModelDef {
  for (const model of models) {
    if (model.id === id) return model
  }
  return DEFAULT_SPEECH_TO_TEXT_MODEL
}
