import { describe, expect, it } from "bun:test"
import {
  buildTerminalAttachment,
  findTerminalMention,
  hasTerminalMention,
} from "../../webview-ui/src/hooks/terminal-context-utils"

describe("terminal context utils", () => {
  it("detects standalone terminal mentions", () => {
    expect(hasTerminalMention("see @terminal output")).toBe(true)
    expect(hasTerminalMention("see foo@terminal output")).toBe(false)
    expect(hasTerminalMention("see @terminal-output")).toBe(false)
  })

  it("returns mention source range", () => {
    expect(findTerminalMention("hello @terminal")!).toEqual({ value: "@terminal", start: 6, end: 15 })
  })

  it("builds a text attachment with source metadata", () => {
    const attachment = buildTerminalAttachment("check @terminal", "npm failed")!
    expect(attachment.mime).toBe("text/plain")
    expect(attachment.filename).toBe("terminal-output.txt")
    expect(attachment.url).toBe("data:text/plain;charset=utf-8,npm%20failed")
    expect(attachment.source?.text).toEqual({ value: "@terminal", start: 6, end: 15 })
  })
})
