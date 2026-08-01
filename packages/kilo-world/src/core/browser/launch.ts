import type { WorldConfig } from "../../types"
import { findSystemChrome } from "./chrome"

export namespace Launch {
  export type Options = {
    headless: boolean
    antiDetect: boolean
    timeoutMs: number
    viewport: { width: number; height: number }
    executablePath?: string
    args: string[]
  }

  export function fromConfig(cfg: WorldConfig): Options {
    const exe = cfg.browser.executablePath ?? (cfg.browser.useSystemChrome ? findSystemChrome() : undefined)
    const out: Options = {
      headless: cfg.browser.headless,
      antiDetect: cfg.browser.antiDetect,
      timeoutMs: cfg.browser.timeoutMs,
      viewport: cfg.browser.viewport,
      args: [...cfg.browser.args],
    }
    if (exe) out.executablePath = exe
    return out
  }

  export function launchArgs(opts: Options): string[] {
    const args = [...opts.args]
    args.push(`--window-size=${opts.viewport.width},${opts.viewport.height}`)
    return Array.from(new Set(args))
  }

  export function hide(headless: boolean, platform: NodeJS.Platform = process.platform): boolean {
    return platform === "win32" && headless
  }

  export function channel(opts: Pick<Options, "headless" | "executablePath">): "chromium" | undefined {
    return opts.headless && !opts.executablePath ? "chromium" : undefined
  }

  export function contextOptions(opts: Options): { viewport: { width: number; height: number } } {
    return { viewport: opts.viewport }
  }

  export const TIMEOUT_MS_DEFAULT = 30_000
  export const SCREENSHOT_TIMEOUT_MS_DEFAULT = 10_000
  export const SCREENSHOT_PAINT_WAIT_MS_DEFAULT = 750
}
