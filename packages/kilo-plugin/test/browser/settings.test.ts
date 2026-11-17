import { describe, expect, test } from "bun:test"
import { resolve, defaultHeadless } from "../../src/browser/settings"

describe("browser settings", () => {
  test("defaults to playwright and full observation", () => {
    expect(resolve(undefined, {})).toEqual({
      backend: "playwright",
      observation: "full",
      allowSensitive: false,
      target: null,
      headless: defaultHeadless("linux", {}),
    })
  })

  test("reads the decoded config keys", () => {
    expect(resolve({ backend: "extension", observation: "diff", allow_sensitive: true, headless: true, target: "chrome:abc" }, {})).toEqual({
      backend: "extension",
      observation: "diff",
      allowSensitive: true,
      target: "chrome:abc",
      headless: true,
    })
  })

  test("keeps `off` as a backend choice", () => {
    expect(resolve({ backend: "off" }, {}).backend).toBe("off")
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
