import { describe, expect, it } from "bun:test"
import { nextTab } from "../../webview-ui/agent-manager/tab-accessibility"

describe("nextTab", () => {
  it("selects an adjacent review or terminal tab after closing a session", () => {
    expect(nextTab(["session", "review", "terminal:shell"], "session")).toBe("review")
    expect(nextTab(["session", "review", "terminal:shell"], "review")).toBe("terminal:shell")
  })

  it("falls back to the preceding tab at the end of the strip", () => {
    expect(nextTab(["session", "review", "terminal:shell"], "terminal:shell")).toBe("review")
  })

  it("returns undefined without a remaining tab", () => {
    expect(nextTab(["session"], "session")).toBeUndefined()
    expect(nextTab(["session"], "unknown")).toBeUndefined()
  })
})
