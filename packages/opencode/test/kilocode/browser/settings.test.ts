import { describe, expect, test } from "bun:test"
import { defaultHeadless, resolve } from "../../../src/kilocode/browser/settings"

describe("browser settings", () => {
  test("defaults to playwright and full observation", () => {
    expect(resolve({})).toEqual({
      backend: "playwright",
      observation: "full",
      allowSensitive: false,
      target: null,
      headless: defaultHeadless(),
      extension: false,
    })
  })

  test("reads the extension flag and headless choice", () => {
    expect(
      resolve({ browser: { backend: "extension", headless: true }, experimental: { browser_extension: true } }),
    ).toEqual({
      backend: "extension",
      observation: "full",
      allowSensitive: false,
      target: null,
      headless: true,
      extension: true,
    })
  })

  test("keeps the extension backend unavailable until the flag is on", () => {
    expect(resolve({ browser: { backend: "extension" } }).extension).toBe(false)
  })

  test("runs headed when a display is available", () => {
    expect(defaultHeadless("darwin", {})).toBe(false)
    expect(defaultHeadless("linux", { DISPLAY: ":0" })).toBe(false)
    expect(defaultHeadless("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(false)
  })

  test("runs headless without a display or over SSH", () => {
    expect(defaultHeadless("linux", {})).toBe(true)
    expect(defaultHeadless("darwin", { SSH_CONNECTION: "10.0.0.1 5000 10.0.0.2 22" })).toBe(true)
    expect(defaultHeadless("win32", { SSH_TTY: "/dev/pts/0" })).toBe(true)
  })
})
