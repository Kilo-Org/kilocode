import { describe, expect, test } from "bun:test"
import { marker } from "../../src/kilocode/pty/smoke"

describe("PTY smoke output", () => {
  test("detects a marker after PowerShell formatting", () => {
    const output =
      "\x1b[93mecho KILO_PTY_READY\r\n\x1b[mKILO_PTY_READY\r\n\x1b]0;Administrator: PowerShell\x07PS> "

    expect(marker(output)).toBe(true)
  })

  test("does not accept the echoed command", () => {
    expect(marker("\x1b[93mecho KILO_PTY_READY\r\n\x1b[mPS> ")).toBe(false)
  })

  test("detects a marker around OSC and DCS sequences", () => {
    const output = "\x1b]133;A\x07\x1bP+q4d73\x1b\\KILO_PTY_READY\r\n"

    expect(marker(output)).toBe(true)
  })
})
