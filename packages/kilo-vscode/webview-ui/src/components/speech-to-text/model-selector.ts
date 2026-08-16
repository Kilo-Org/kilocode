import type { SpeechToTextModelDef } from "../../../../src/speech-to-text/models"

export type SpeechToTextModelOption = {
  value: string
  label: string
  provider: string
}

export function speechToTextModelOptions(models: readonly SpeechToTextModelDef[]): SpeechToTextModelOption[] {
  return models.map((model) => ({
    value: model.id,
    label: model.label,
    provider: model.provider,
  }))
}
