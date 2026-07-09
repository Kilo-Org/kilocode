import { KILO_PROVIDER_ID } from "../../../../src/shared/provider-model"
import { getSpeechToTextModel } from "../../../../src/speech-to-text/models"

type Cfg = {
  enabled_providers?: string[]
  disabled_providers?: string[]
  experimental?: {
    speech_to_text_model?: string
  }
}

type AuthState = "api" | "oauth" | "wellknown"

export function hasSpeechToTextAccess(cfg: Cfg, auth: Readonly<Record<string, AuthState>>): boolean {
  const enabled = !cfg.enabled_providers || cfg.enabled_providers.includes(KILO_PROVIDER_ID)
  const type = auth[KILO_PROVIDER_ID]
  return enabled && !cfg.disabled_providers?.includes(KILO_PROVIDER_ID) && (type === "api" || type === "oauth")
}

export function canUseSpeechToText(cfg: Cfg, auth: Readonly<Record<string, AuthState>>): boolean {
  return hasSpeechToTextAccess(cfg, auth)
}

export function selectedSpeechToTextModel(cfg: Cfg): string {
  return getSpeechToTextModel(cfg.experimental?.speech_to_text_model).id
}
