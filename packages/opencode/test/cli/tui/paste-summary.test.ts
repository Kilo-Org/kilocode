// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { isPasteSummaryEnabled, PASTE_SUMMARY_ENABLED_KEY } from "../../../src/cli/cmd/tui/util/paste-summary"

function kv(value: boolean | undefined) {
  return {
    get: (_key: string, defaultValue?: boolean) => value ?? defaultValue ?? false,
  }
}

describe("paste summary setting", () => {
  test("uses the stored toggle when config allows paste summaries", () => {
    expect(isPasteSummaryEnabled(kv(true), {})).toBe(true)
    expect(isPasteSummaryEnabled(kv(false), {})).toBe(false)
    expect(isPasteSummaryEnabled(kv(undefined), {})).toBe(true)
  })

  test("config disable overrides a previously enabled stored toggle", () => {
    expect(
      isPasteSummaryEnabled(kv(true), {
        experimental: {
          disable_paste_summary: true,
        },
      }),
    ).toBe(false)
  })

  test("exports the persisted toggle key used by the command menu", () => {
    expect(PASTE_SUMMARY_ENABLED_KEY).toBe("paste_summary_enabled")
  })
})
