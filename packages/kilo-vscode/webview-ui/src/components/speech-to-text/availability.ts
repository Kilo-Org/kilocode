import type { SpeechToTextStatus } from "../../../../src/protocol"
import { SPEECH_TO_TEXT_MODELS, type SpeechToTextModelDef } from "../../../../src/speech-to-text/models"

type Cfg = {
  experimental?: {
    speech_to_text_model?: string
    speech_to_text_base_url?: string
    speech_to_text_api_key?: string
  }
}

export function hasCustomSpeechToTextSource(cfg: Cfg): boolean {
  return !!cfg.experimental?.speech_to_text_base_url?.trim()
}

/** Gateway mode accepts the stored ID only when the live catalog lists it; custom mode uses the explicit ID. */
export function selectedSpeechToTextModel(
  cfg: Cfg,
  models: readonly SpeechToTextModelDef[] = SPEECH_TO_TEXT_MODELS,
): string {
  const id = cfg.experimental?.speech_to_text_model?.trim()
  if (hasCustomSpeechToTextSource(cfg)) return id ?? ""
  if (id && models.some((model) => model.id === id)) return id
  return models[0]?.id ?? SPEECH_TO_TEXT_MODELS[0]!.id
}

export function emptySpeechStatus(): SpeechToTextStatus {
  return {
    enabled: false,
    remote: false,
    signedIn: false,
    source: "gateway",
    model: SPEECH_TO_TEXT_MODELS[0]!.id,
    models: [...SPEECH_TO_TEXT_MODELS],
    settings: {},
  }
}
