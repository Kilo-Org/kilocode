import { SPEECH_TO_TEXT_MODELS } from "../../../../src/speech-to-text/models"

export type SpeechToTextModelOption = {
  value: string
  label: string
  provider: string
}

export const SPEECH_TO_TEXT_MODEL_OPTIONS: SpeechToTextModelOption[] = SPEECH_TO_TEXT_MODELS.map((model) => ({
  value: model.id,
  label: model.label,
  provider: model.provider,
}))
