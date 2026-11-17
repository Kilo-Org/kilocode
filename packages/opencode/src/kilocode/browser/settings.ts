import type { Config } from "@/config/config"

export type BackendID = "playwright" | "extension"
export type Backend = BackendID | "off"
export type Observation = "full" | "diff" | "none"

export type Settings = {
  backend: Backend
  observation: Observation
  allowSensitive: boolean
  target: string | null
}

export const DEFAULT_BACKEND: Backend = "playwright"
export const DEFAULT_OBSERVATION: Observation = "full"

/** Effective browser settings, with the documented defaults applied. */
export function resolve(cfg: Pick<Config.Info, "browser">): Settings {
  return {
    backend: cfg.browser?.backend ?? DEFAULT_BACKEND,
    observation: cfg.browser?.observation ?? DEFAULT_OBSERVATION,
    allowSensitive: cfg.browser?.allowSensitive ?? false,
    target: cfg.browser?.target ?? null,
  }
}
