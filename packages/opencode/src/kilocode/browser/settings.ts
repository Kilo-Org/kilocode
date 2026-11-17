import type { Config } from "@/config/config"

export type BackendID = "playwright" | "extension"
export type Backend = BackendID | "off"
export type Observation = "full" | "diff" | "none"

export type Settings = {
  backend: Backend
  observation: Observation
  allowSensitive: boolean
  target: string | null
  headless: boolean
  /** `experimental.browser_extension`: the extension backend stays unavailable until it is on. */
  extension: boolean
}

export const DEFAULT_BACKEND: Backend = "playwright"
export const DEFAULT_OBSERVATION: Observation = "full"

/**
 * Headed by default so the user can watch the agent, headless when there is no display to show it:
 * no X11 or Wayland session on Linux, or an SSH login (a remote machine has no visible screen).
 */
export function defaultHeadless(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return true
  if (platform === "linux") return !env.DISPLAY && !env.WAYLAND_DISPLAY
  return false
}

/** Effective browser settings, with the documented defaults applied. */
export function resolve(cfg: Pick<Config.Info, "browser" | "experimental">): Settings {
  return {
    backend: cfg.browser?.backend ?? DEFAULT_BACKEND,
    observation: cfg.browser?.observation ?? DEFAULT_OBSERVATION,
    allowSensitive: cfg.browser?.allowSensitive ?? false,
    target: cfg.browser?.target ?? null,
    headless: cfg.browser?.headless ?? defaultHeadless(),
    extension: cfg.experimental?.browser_extension === true,
  }
}
