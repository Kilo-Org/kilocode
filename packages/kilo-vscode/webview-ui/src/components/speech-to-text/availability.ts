import { KILO_PROVIDER_ID } from "../../../../src/shared/provider-model"
import {
  DEFAULT_SPEECH_TO_TEXT_MODEL,
  SPEECH_TO_TEXT_MODELS,
  type SpeechToTextModelDef,
} from "../../../../src/speech-to-text/models"

type Cfg = {
  enabled_providers?: string[]
  disabled_providers?: string[]
  experimental?: {
    speech_to_text_model?: string
    speech_to_text_base_url?: string
  }
}

type AuthState = "api" | "oauth" | "wellknown"

export function hasCustomSpeechToTextSource(cfg: Cfg): boolean {
  return !!cfg.experimental?.speech_to_text_base_url?.trim()
}

export function hasSpeechToTextAccess(cfg: Cfg, auth: Readonly<Record<string, AuthState>>): boolean {
  if (hasCustomSpeechToTextSource(cfg)) return true
  const enabled = !cfg.enabled_providers || cfg.enabled_providers.includes(KILO_PROVIDER_ID)
  const type = auth[KILO_PROVIDER_ID]
  return enabled && !cfg.disabled_providers?.includes(KILO_PROVIDER_ID) && (type === "api" || type === "oauth")
}

export function canUseSpeechToText(cfg: Cfg, auth: Readonly<Record<string, AuthState>>): boolean {
  return hasSpeechToTextAccess(cfg, auth)
}

export function selectedSpeechToTextModel(
  cfg: Cfg,
  models: readonly SpeechToTextModelDef[] = SPEECH_TO_TEXT_MODELS,
): string {
  const id = cfg.experimental?.speech_to_text_model
  const known = models.find((model) => model.id === id)?.id
  if (known) return known
  if (id && hasCustomSpeechToTextSource(cfg)) return id
  return models[0]?.id ?? DEFAULT_SPEECH_TO_TEXT_MODEL.id
}
