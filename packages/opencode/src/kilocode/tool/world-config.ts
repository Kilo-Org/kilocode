import { defaultConfig } from "@kilocode/world/client"
import type { WorldConfig } from "@kilocode/world/types"

export type Input = {
  world?: {
    browser?: {
      headless?: boolean
      anti_detect?: boolean
      timeout_ms?: number
      viewport?: { width: number; height: number }
      executable_path?: string
      use_system_chrome?: boolean
      args?: string[]
    }
  }
}

export function resolve(cfg: Input, trusted: Input = {}): WorldConfig {
  const base = defaultConfig()
  const browser = cfg.world?.browser
  const global = trusted.world?.browser
  if (!browser && !global) return base
  return {
    browser: {
      ...base.browser,
      ...(browser?.headless !== undefined ? { headless: browser.headless } : {}),
      ...(browser?.anti_detect !== undefined ? { antiDetect: browser.anti_detect } : {}),
      ...(browser?.timeout_ms !== undefined ? { timeoutMs: browser.timeout_ms } : {}),
      ...(browser?.viewport ? { viewport: browser.viewport } : {}),
      ...(global?.args ? { args: [...global.args] } : {}),
      ...(global?.executable_path ? { executablePath: global.executable_path } : {}),
      ...(browser?.use_system_chrome !== undefined ? { useSystemChrome: browser.use_system_chrome } : {}),
    },
    home: base.home,
  }
}
