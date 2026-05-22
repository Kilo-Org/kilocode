import { KILO_PROVIDER_ID } from "../../../../src/shared/provider-model"
import { getSpeechToTextModel } from "../../../../src/speech-to-text/models"

type Cfg = {
  disabled_providers?: string[]
  experimental?: {
    speech_to_text?: boolean
    speech_to_text_model?: string
  }
}

export function hasSpeechToTextAccess(cfg: Cfg, providers: readonly string[], profile: unknown | null): boolean {
  return providers.includes(KILO_PROVIDER_ID) && !cfg.disabled_providers?.includes(KILO_PROVIDER_ID) && !!profile
}

export function canUseSpeechToText(cfg: Cfg, providers: readonly string[], profile: unknown | null): boolean {
  return cfg.experimental?.speech_to_text === true && hasSpeechToTextAccess(cfg, providers, profile)
}

export function selectedSpeechToTextModel(cfg: Cfg): string {
  return getSpeechToTextModel(cfg.experimental?.speech_to_text_model).id
}
