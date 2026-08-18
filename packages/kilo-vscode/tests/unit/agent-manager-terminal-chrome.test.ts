import { describe, expect, it } from "bun:test"
import { terminalChrome, terminalClosable, terminalStoppable } from "../../webview-ui/agent-manager/terminal/chrome"

describe("Agent Manager Run terminal chrome", () => {
  it("keeps the console icon for user terminals", () => {
    expect(terminalChrome("Terminal 1", undefined)).toEqual({ icon: "console", tooltip: "Terminal 1" })
  })

  it("renders compact status icons with accessible Run status details", () => {
    expect(terminalChrome("Run", { state: "running", kind: "run" })).toEqual({
      icon: "spinner",
      tooltip: "Run (Running)",
    })
    expect(terminalChrome("Run", { state: "stopping", kind: "run" })).toEqual({
      icon: "spinner",
      tooltip: "Run (Stopping)",
    })
    expect(terminalChrome("Run", { state: "exited", exitCode: 0, kind: "run" })).toEqual({
      icon: "success",
      tooltip: "Run (Exited, code 0)",
    })
    expect(terminalChrome("Run", { state: "exited", exitCode: 1, kind: "run" })).toEqual({
      icon: "failure",
      tooltip: "Run (Exited, code 1)",
    })
    expect(terminalChrome("Run", { state: "failed", kind: "run" })).toEqual({
      icon: "failure",
      tooltip: "Run (Failed)",
    })
  })

  it("keeps a running Setup tab unclosable until the script settles", () => {
    expect(terminalClosable(undefined)).toBe(true)
    expect(terminalClosable({ state: "running", kind: "run" })).toBe(true)
    expect(terminalClosable({ state: "running", kind: "setup" })).toBe(false)
    expect(terminalClosable({ state: "stopping", kind: "setup" })).toBe(false)
    expect(terminalClosable({ state: "exited", exitCode: 0, kind: "setup" })).toBe(true)
    expect(terminalClosable({ state: "exited", exitCode: 1, kind: "setup" })).toBe(true)
    expect(terminalClosable({ state: "failed", kind: "setup" })).toBe(true)
  })

  it("offers a deliberate stop only while Setup is running", () => {
    expect(terminalStoppable(undefined)).toBe(false)
    expect(terminalStoppable({ state: "running", kind: "run" })).toBe(false)
    expect(terminalStoppable({ state: "running", kind: "setup" })).toBe(true)
    expect(terminalStoppable({ state: "stopping", kind: "setup" })).toBe(false)
    expect(terminalStoppable({ state: "exited", exitCode: 1, kind: "setup" })).toBe(false)
    expect(terminalStoppable({ state: "failed", kind: "setup" })).toBe(false)
  })
})
