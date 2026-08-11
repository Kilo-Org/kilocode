import { afterAll, describe, expect, test } from "bun:test"
import { Launch } from "../src/core/browser/launch"
import { findSystemChrome } from "../src/core/browser/chrome"
import type { WorldConfig } from "../src/types"

afterAll(() => {})

function cfg(patch: Partial<WorldConfig["browser"]>): WorldConfig {
  return {
    browser: {
      headless: true,
      antiDetect: false,
      timeoutMs: 30_000,
      viewport: { width: 1280, height: 720 },
      args: [],
      ...patch,
    },
    home: "/tmp/world-home",
  }
}

describe("Launch.fromConfig", () => {
  test("uses executablePath when explicitly set", () => {
    const out = Launch.fromConfig(cfg({ executablePath: "/custom/chrome" }))
    expect(out.executablePath).toBe("/custom/chrome")
  })

  test("explicit executablePath wins over useSystemChrome", () => {
    const detected = findSystemChrome()
    const out = Launch.fromConfig(cfg({ executablePath: "/explicit/chrome", useSystemChrome: true }))
    expect(out.executablePath).toBe("/explicit/chrome")
    if (detected) expect(out.executablePath).not.toBe(detected)
  })

  test("useSystemChrome resolves to detected chrome when present", () => {
    const detected = findSystemChrome()
    if (!detected) return
    const out = Launch.fromConfig(cfg({ useSystemChrome: true }))
    expect(out.executablePath).toBe(detected)
  })

  test("useSystemChrome leaves executablePath unset when chrome is missing", () => {
    if (findSystemChrome()) return
    const out = Launch.fromConfig(cfg({ useSystemChrome: true }))
    expect(out.executablePath).toBeUndefined()
  })

  test("does not set executablePath by default", () => {
    const out = Launch.fromConfig(cfg({}))
    expect(out.executablePath).toBeUndefined()
  })

  test("hides only headless Chromium launches on Windows", () => {
    expect(Launch.hide(true, "win32")).toBe(true)
    expect(Launch.hide(false, "win32")).toBe(false)
    expect(Launch.hide(true, "linux")).toBe(false)
  })

  test("uses unified headless Chromium without overriding explicit executables", () => {
    expect(Launch.channel(Launch.fromConfig(cfg({ headless: true })))).toBe("chromium")
    expect(Launch.channel(Launch.fromConfig(cfg({ headless: false })))).toBeUndefined()
    expect(Launch.channel(Launch.fromConfig(cfg({ headless: true, executablePath: "/custom/chrome" })))).toBeUndefined()
  })
})
