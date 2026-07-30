import { describe, expect, it } from "bun:test"
import { terminalChrome } from "../../webview-ui/agent-manager/terminal/chrome"

describe("Agent Manager Run terminal chrome", () => {
  it("keeps the console icon for user terminals", () => {
    expect(terminalChrome("Terminal 1", undefined)).toEqual({ icon: "console", tooltip: "Terminal 1" })
  })

  it("renders compact status icons with accessible Run status details", () => {
    expect(terminalChrome("Run", { state: "running" })).toEqual({ icon: "spinner", tooltip: "Run (Running)" })
    expect(terminalChrome("Run", { state: "stopping" })).toEqual({ icon: "spinner", tooltip: "Run (Stopping)" })
    expect(terminalChrome("Run", { state: "exited", exitCode: 0 })).toEqual({
      icon: "success",
      tooltip: "Run (Exited, code 0)",
    })
    expect(terminalChrome("Run", { state: "exited", exitCode: 1 })).toEqual({
      icon: "failure",
      tooltip: "Run (Exited, code 1)",
    })
    expect(terminalChrome("Run", { state: "failed" })).toEqual({ icon: "failure", tooltip: "Run (Failed)" })
  })
})
