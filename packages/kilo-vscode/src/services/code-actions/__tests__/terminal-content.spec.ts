import { describe, expect, it } from "vitest"
import { trimTerminalOutput } from "../terminal-content"

describe("trimTerminalOutput", () => {
  it("preserves one-line content", () => {
    expect(trimTerminalOutput("echo hi")).toBe("echo hi")
  })

  it("preserves the last line when no trailing prompt was copied", () => {
    expect(trimTerminalOutput("python main.py\nTraceback...\nValueError: boom")).toBe(
      "python main.py\nTraceback...\nValueError: boom",
    )
  })

  it("does not trim arbitrary trailing lines that happen to match an earlier prefix", () => {
    expect(trimTerminalOutput("PASS a.test.ts\nPASS")).toBe("PASS a.test.ts\nPASS")
  })

  it("drops a duplicated trailing prompt and keeps the matching command block", () => {
    expect(trimTerminalOutput("$ echo hi\nhi\n$")).toBe("$ echo hi\nhi")
  })

  it("preserves earlier copied terminal history in all mode", () => {
    expect(trimTerminalOutput("$ a\n1\n$ b\n2\n$", "all")).toBe("$ a\n1\n$ b\n2")
  })
})
