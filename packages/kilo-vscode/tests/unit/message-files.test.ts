import { describe, expect, it } from "bun:test"
import { parseMessageFiles } from "../../src/kilo-provider/message-files"

describe("parseMessageFiles", () => {
  it("accepts terminal text attachments with source metadata", () => {
    const files = parseMessageFiles([
      {
        mime: "text/plain",
        url: "data:text/plain;charset=utf-8,terminal%20output",
        filename: "terminal-output.txt",
        source: {
          type: "file",
          path: "terminal-output.txt",
          text: { value: "@terminal", start: 0, end: 9 },
        },
      },
    ])

    expect(files?.[0]?.filename).toBe("terminal-output.txt")
    expect(files?.[0]?.source?.text.value).toBe("@terminal")
  })

  it("rejects unsupported URLs", () => {
    expect(parseMessageFiles([{ mime: "text/plain", url: "https://example.com/file.txt" }])).toBeUndefined()
  })

  it("accepts past-chat session attachments", () => {
    const files = parseMessageFiles([
      {
        mime: "text/plain",
        url: "session:ses_07c08a2ddffeXample",
        filename: "fix-auth-bug.md",
        source: {
          type: "file",
          path: "session:ses_07c08a2ddffeXample",
          text: { value: "@Fix auth bug", start: 0, end: 13 },
        },
      },
    ])

    expect(files?.[0]?.url).toBe("session:ses_07c08a2ddffeXample")
    expect(files?.[0]?.filename).toBe("fix-auth-bug.md")
  })
})
