import { describe, it, expect } from "bun:test"
import { SLASH_PATTERN } from "../../webview-ui/src/hooks/useSlashCommand"

describe("SLASH_PATTERN", () => {
  it("matches '/' at the start of input", () => {
    expect("/".match(SLASH_PATTERN)).not.toBeNull()
  })

  it("matches '/new' at the start of input", () => {
    expect("/new".match(SLASH_PATTERN)).not.toBeNull()
  })

  it("does not match plain text", () => {
    expect("hello".match(SLASH_PATTERN)).toBeNull()
  })

  it("does not match text followed by '/'", () => {
    expect("hello/".match(SLASH_PATTERN)).toBeNull()
  })

  // Reproduces the bug: typing "/" on a second line after existing text
  it("matches '/' at the start of a new line when preceded by text on previous line", () => {
    // User typed "test\n/" — cursor is at end, before = "test\n/"
    const before = "test\n/"
    expect(before.match(SLASH_PATTERN)).not.toBeNull()
  })

  it("matches '/new' at the start of a new line when preceded by text on previous line", () => {
    const before = "some context\n/new"
    expect(before.match(SLASH_PATTERN)).not.toBeNull()
  })

  it("matches '/' after multiple lines of text", () => {
    const before = "line one\nline two\n/"
    expect(before.match(SLASH_PATTERN)).not.toBeNull()
  })
})
