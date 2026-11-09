import { describe, expect, test } from "bun:test"
import { DISPLAY_DEFAULTS } from "../src/protocol"
import { layoutChanged } from "../webview-ui/src/v2/display-layout"

describe("layoutChanged", () => {
  test("is true for a change in any tool block layout", () => {
    expect(layoutChanged(DISPLAY_DEFAULTS, { ...DISPLAY_DEFAULTS, codeModeDisplay: "expanded" })).toBe(true)
    expect(layoutChanged(DISPLAY_DEFAULTS, { ...DISPLAY_DEFAULTS, terminalCommandDisplay: "collapsed" })).toBe(true)
    expect(layoutChanged(DISPLAY_DEFAULTS, { ...DISPLAY_DEFAULTS, codeEditDisplay: "expanded" })).toBe(true)
    expect(layoutChanged(DISPLAY_DEFAULTS, { ...DISPLAY_DEFAULTS, mcpToolDisplay: "expanded" })).toBe(true)
  })

  test("ignores a repeated load and a reasoning-only change, so manual toggles survive", () => {
    expect(layoutChanged(DISPLAY_DEFAULTS, { ...DISPLAY_DEFAULTS })).toBe(false)
    expect(layoutChanged(DISPLAY_DEFAULTS, { ...DISPLAY_DEFAULTS, reasoningDisplay: "preview" })).toBe(false)
  })
})
