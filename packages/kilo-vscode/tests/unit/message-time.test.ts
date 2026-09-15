import { describe, it, expect } from "bun:test"
import { formatClock, formatDuration } from "../../webview-ui/src/utils/message-time"
import { LOCALES, localeToBcp47 } from "../../webview-ui/src/context/language-utils"

describe("message-time", () => {
  it("resolves every Kilo UI language to a real Intl locale", () => {
    for (const locale of LOCALES) {
      const tag = localeToBcp47(locale)
      const resolved = new Intl.DateTimeFormat(tag, { timeStyle: "short" }).resolvedOptions().locale
      expect(resolved.split("-")[0]).toBe(tag.split("-")[0])
    }
  })

  it("formats the clock in the UI language's convention and local timezone", () => {
    const at = Date.UTC(2026, 0, 1, 13, 5)
    expect(formatClock(at, "en")).toBe(new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(new Date(at)))
    expect(formatClock(at, "de")).toBe(new Intl.DateTimeFormat("de", { timeStyle: "short" }).format(new Date(at)))
    expect(formatClock(at, "de")).not.toMatch(/AM|PM/)
  })

  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(1500)).toBe("2s")
    expect(formatDuration(45_000)).toBe("45s")
  })

  it("formats minute-scale durations with seconds", () => {
    expect(formatDuration(60_000)).toBe("1m 0s")
    expect(formatDuration(125_000)).toBe("2m 5s")
  })

  it("formats hour-scale durations with minutes", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m")
    expect(formatDuration(3_780_000)).toBe("1h 3m")
  })

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5000)).toBe("0s")
  })
})
