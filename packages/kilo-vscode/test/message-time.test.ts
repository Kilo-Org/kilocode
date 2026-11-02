// The v1 chat-line clock and duration helpers, from `tests/unit/message-time.test.ts`.
import { describe, expect, test } from "bun:test"
import { LOCALES, localeToBcp47 } from "../webview-ui/src/context/language-utils"
import { formatClock, formatDuration } from "../webview-ui/src/utils/message-time"

describe("message-time", () => {
  test("resolves every Kilo UI language to a real Intl locale", () => {
    for (const locale of LOCALES) {
      const tag = localeToBcp47(locale)
      const resolved = new Intl.DateTimeFormat(tag, { timeStyle: "short" }).resolvedOptions().locale
      expect(resolved.split("-")[0]).toBe(tag.split("-")[0])
    }
  })

  test("formats the clock in the UI language's convention", () => {
    const at = Date.UTC(2026, 0, 1, 13, 5)
    // 12-hour convention for English, 24-hour for German, regardless of the
    // local timezone the test runs in.
    expect(formatClock(at, "en")).toMatch(/^\d{1,2}:\d{2}\s?[AP]M$/)
    expect(formatClock(at, "de")).toMatch(/^\d{1,2}:\d{2}$/)
    expect(formatClock(at, "de")).not.toMatch(/AM|PM/)
  })

  test("formats sub-minute durations as seconds", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(1500)).toBe("2s")
    expect(formatDuration(45_000)).toBe("45s")
  })

  test("formats minute-scale durations with seconds", () => {
    expect(formatDuration(60_000)).toBe("1m 0s")
    expect(formatDuration(125_000)).toBe("2m 5s")
  })

  test("formats hour-scale durations with minutes", () => {
    expect(formatDuration(3_600_000)).toBe("1h 0m")
    expect(formatDuration(3_780_000)).toBe("1h 3m")
  })

  test("clamps negative durations to zero", () => {
    expect(formatDuration(-5000)).toBe("0s")
  })

  test("resolves zht to zh-TW instead of the system default", () => {
    // zh-TW always prefixes a Chinese day period (the exact period depends on the host time zone).
    const clock = formatClock(0, "zht")
    expect(clock).toMatch(/[凌晨清晨上午中午下午晚上]/u)
    expect(clock).not.toContain("AM")
    expect(clock).not.toContain("PM")
  })
})
