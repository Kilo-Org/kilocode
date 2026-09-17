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

export function hasExplicitSpeechToTextModel(cfg: Cfg): boolean {
  return !!cfg.experimental?.speech_to_text_model?.trim()
}

export function hasSpeechToTextAccess(cfg: Cfg, auth: Readonly<Record<string, AuthState>>): boolean {
  if (hasCustomSpeechToTextSource(cfg)) return true
  const enabled = !cfg.enabled_providers || cfg.enabled_providers.includes(KILO_PROVIDER_ID)
  const type = auth[KILO_PROVIDER_ID]
  return enabled && !cfg.disabled_providers?.includes(KILO_PROVIDER_ID) && (type === "api" || type === "oauth")
}

export function canUseSpeechToText(cfg: Cfg, auth: Readonly<Record<string, AuthState>>, capture = true): boolean {
  if (!capture) return false
  if (!hasSpeechToTextAccess(cfg, auth)) return false
  // A custom endpoint needs an explicit model. Never fall back to a Gateway model ID,
  // which the endpoint would reject or misinterpret.
  return !hasCustomSpeechToTextSource(cfg) || hasExplicitSpeechToTextModel(cfg)
}

export function selectedSpeechToTextModel(
  cfg: Cfg,
  models: readonly SpeechToTextModelDef[] = SPEECH_TO_TEXT_MODELS,
): string {
  const id = cfg.experimental?.speech_to_text_model?.trim()
  // Custom mode uses only the explicit model ID and never guesses from a catalog.
  if (hasCustomSpeechToTextSource(cfg)) return id ?? ""
  // Gateway mode accepts the stored ID only when the Gateway-sourced catalog lists it.
  // A leftover custom ID falls back to a valid Gateway default.
  if (id && models.some((model) => model.id === id)) return id
  return models[0]?.id ?? DEFAULT_SPEECH_TO_TEXT_MODEL.id
}
