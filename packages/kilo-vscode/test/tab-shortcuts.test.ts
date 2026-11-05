import { describe, expect, test } from "bun:test"
import { tabShortcutTarget } from "../src/tab-shortcuts"

describe("tab shortcut target", () => {
  test("the focused sidebar wins while the Agent Manager panel is the selected editor tab", () => {
    expect(tabShortcutTarget(true, true)).toBe("sidebar")
  })

  test("the Agent Manager receives the shortcut when the sidebar is not focused", () => {
    expect(tabShortcutTarget(false, true)).toBe("agentManager")
  })

  test("neither surface receives the shortcut when neither is focused", () => {
    expect(tabShortcutTarget(false, false)).toBeUndefined()
  })
})
