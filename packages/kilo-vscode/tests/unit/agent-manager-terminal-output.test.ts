import { describe, expect, it } from "bun:test"
import {
  readTerminalOutput,
  registerTerminalOutput,
  unregisterTerminalOutput,
} from "../../webview-ui/agent-manager/terminal/output"

describe("Agent Manager terminal output", () => {
  it("reads and unregisters a terminal buffer", () => {
    registerTerminalOutput("term-1", () => "embedded output")
    expect(readTerminalOutput("term-1")).toBe("embedded output")
    unregisterTerminalOutput("term-1")
    expect(readTerminalOutput("term-1")).toBeUndefined()
  })

  it("truncates large terminal buffers", () => {
    registerTerminalOutput("term-2", () => Array.from({ length: 501 }, (_, index) => `line-${index}`).join("\n"))
    const output = readTerminalOutput("term-2")
    expect(output).toContain("[...1 lines omitted...]")
    expect(output).toContain("line-0")
    expect(output).toContain("line-500")
    unregisterTerminalOutput("term-2")
  })
})
