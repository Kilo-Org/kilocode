import { describe, expect, it } from "bun:test"
import { surface } from "../../src/kilo-provider/send-now"

describe("surface", () => {
  it("classifies each chat host", () => {
    expect(surface({ platform: "agent-manager", tabLabel: "Agent Manager" })).toBe("agent-manager")
    expect(surface({ topBarSurface: "tab" })).toBe("editor")
    expect(surface({ focusContext: "kilo-code.new.sidebarFocused" })).toBe("sidebar")
  })
})
