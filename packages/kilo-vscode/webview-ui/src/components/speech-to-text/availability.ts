import { KILO_PROVIDER_ID } from "../../../../src/shared/provider-model"
import { getSpeechToTextModel } from "../../../../src/speech-to-text/models"

type Cfg = {
  disabled_providers?: string[]
}

export function hasSpeechToTextAccess(cfg: Cfg, providers: readonly string[], profile: unknown | null): boolean {
  return providers.includes(KILO_PROVIDER_ID) && !cfg.disabled_providers?.includes(KILO_PROVIDER_ID) && !!profile
}

export function canUseSpeechToText(
  settings: Record<string, unknown>,
  cfg: Cfg,
  providers: readonly string[],
  profile: unknown | null,
): boolean {
  return settings["speechToText.enabled"] === true && hasSpeechToTextAccess(cfg, providers, profile)
}

export function selectedSpeechToTextModel(settings: Record<string, unknown>): string {
  return getSpeechToTextModel(String(settings["speechToText.model"] ?? "")).id
}
