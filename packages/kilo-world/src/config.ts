import { existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { WorldConfig, WorldConfigPatch } from "./types"

const DEFAULT_HOME = join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), "kilo-world")

let cached: WorldConfig | null = null

export function hasDisplay(): boolean {
  return (
    process.platform === "darwin" ||
    process.platform === "win32" ||
    Boolean(process.env["DISPLAY"] || process.env["WAYLAND_DISPLAY"])
  )
}

export function defaultConfig(): WorldConfig {
  const headless = !hasDisplay() || process.env["KILO_WORLD_HEADED"] !== "1"
  return {
    browser: {
      headless,
      antiDetect: process.env["KILO_WORLD_ANTI_DETECT"] === "1",
      timeoutMs: 30_000,
      viewport: { width: 1280, height: 720 },
      args: [],
      ...(process.env["KILO_WORLD_CHROMIUM"] ? { executablePath: process.env["KILO_WORLD_CHROMIUM"] } : {}),
    },
    home: process.env["KILO_WORLD_HOME"] ?? DEFAULT_HOME,
  }
}

export function getConfig(): WorldConfig {
  if (!cached) cached = defaultConfig()
  return cached
}

export function setConfig(patch: WorldConfigPatch): WorldConfig {
  const next: WorldConfig = {
    ...getConfig(),
    ...patch,
    browser: { ...getConfig().browser, ...patch.browser },
  }
  if (!Number.isFinite(next.browser.timeoutMs) || next.browser.timeoutMs <= 0) {
    throw new Error("browser timeout must be a positive finite number")
  }
  if (
    !Number.isFinite(next.browser.viewport.width) ||
    next.browser.viewport.width <= 0 ||
    !Number.isFinite(next.browser.viewport.height) ||
    next.browser.viewport.height <= 0
  ) {
    throw new Error("browser viewport dimensions must be positive finite numbers")
  }
  cached = next
  return next
}

export function ensureHome(home: string): string {
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 })
  return home
}
