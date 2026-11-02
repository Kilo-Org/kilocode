import type { SpeechToTextStatus } from "../protocol"
import { DEFAULT_SPEECH_TO_TEXT_MODEL, type SpeechToTextModelDef } from "./models"
import type { SpeechToTextSettings } from "./source"

/** The composer and Settings state from the machine-wide settings and the Gateway account. */
export function resolveSpeechStatus(input: {
  settings: SpeechToTextSettings
  remote: boolean
  signedIn: boolean
  models: readonly SpeechToTextModelDef[]
  secrets?: boolean
  catalogError?: string
}): SpeechToTextStatus {
  const settings = input.secrets ? input.settings : { ...input.settings, apiKey: undefined }
  if (input.settings.baseUrl) {
    const model = input.settings.model ?? ""
    return {
      enabled: !input.remote && !!model,
      remote: input.remote,
      signedIn: false,
      source: "custom",
      model,
      models: [],
      settings,
    }
  }
  const models = [...input.models]
  const stored = input.settings.model
  const model =
    stored && models.some((item) => item.id === stored) ? stored : (models[0]?.id ?? DEFAULT_SPEECH_TO_TEXT_MODEL.id)
  return {
    enabled: !input.remote && input.signedIn,
    remote: input.remote,
    signedIn: input.signedIn,
    source: "gateway",
    model,
    models,
    settings,
    ...(input.catalogError ? { catalogError: input.catalogError } : {}),
  }
}
