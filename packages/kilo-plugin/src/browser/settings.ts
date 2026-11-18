import type { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import type { BackendID } from "./backend"

/** The configured backend, plus `off`, which hides the browser tools entirely. */
export type Backend = BackendID | "off"
export type Observation = "full" | "diff" | "none"

/** The `browser` block as the config schema decodes it; the schema owns the key names. */
export type Config = NonNullable<KiloConfigPolicy.BrowserConfig>

export type Settings = {
  backend: Backend
  observation: Observation
  allowSensitive: boolean
  target: string | null
  headless: boolean
}

export const DEFAULT_BACKEND: Backend = "playwright"
export const DEFAULT_OBSERVATION: Observation = "diff"

/**
 * Headed by default so the user can watch the agent, headless when there is no display to show it: no X11 or
 * Wayland session on Linux, or an SSH login (a remote machine has no visible screen).
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
export function resolve(config: Config | undefined, env: Record<string, string | undefined> = process.env): Settings {
  return {
    backend: config?.backend ?? DEFAULT_BACKEND,
    observation: config?.observation ?? DEFAULT_OBSERVATION,
    allowSensitive: config?.allow_sensitive ?? false,
    target: config?.target ?? null,
    headless: config?.headless ?? defaultHeadless(process.platform, env),
  }
}
