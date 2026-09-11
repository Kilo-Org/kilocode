import { expect, test } from "bun:test"
import { hasReadyMarker } from "../../src/kilocode/pty/smoke-output"

test("detects the PTY marker after Fish title control sequences", () => {
  const output = [
    "\x1b]0;user@host ~/project\x07",
    "\x1b]7;file://host/project\x1b\\",
    "\x1b[?2004hKILO_PTY_READY\x1b[?2004l\r\n",
  ].join("")

  expect(hasReadyMarker(output)).toBe(true)
})

test("does not accept the marker as part of another line", () => {
  expect(hasReadyMarker("prefix KILO_PTY_READY suffix\r\n")).toBe(false)
})
