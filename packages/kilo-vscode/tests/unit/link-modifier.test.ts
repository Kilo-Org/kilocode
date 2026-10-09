import { describe, expect, test } from "bun:test"
import { forcesExternalBrowser } from "../../webview-ui/src/utils/link-modifier"

describe("forcesExternalBrowser", () => {
  test("forces the system browser on shift-click while the Integrated Browser handles links", () => {
    expect(forcesExternalBrowser({ shiftKey: true }, true)).toBe(true)
  })

  test("leaves a plain click to the Integrated Browser", () => {
    expect(forcesExternalBrowser({ shiftKey: false }, true)).toBe(false)
  })

  test("ignores shift when links do not route through the Integrated Browser", () => {
    expect(forcesExternalBrowser({ shiftKey: true }, false)).toBe(false)
    expect(forcesExternalBrowser({ shiftKey: true }, undefined)).toBe(false)
  })
})
