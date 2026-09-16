import { describe, expect, it } from "bun:test"
import { buildGitChangesAttachment as git } from "../../webview-ui/src/hooks/git-changes-context-utils"
import { buildTerminalAttachment as terminal } from "../../webview-ui/src/hooks/terminal-context-utils"

describe.each([
  ["terminal", terminal, "terminal-output.txt"],
  ["git-changes", git, "git-changes.txt"],
])("%s context utils", (token, build, filename) => {
  const value = `@${token}`

  it("rejects missing mentions and false prefixes or suffixes", () => {
    for (const text of ["plain text", `foo${value}`, `${value}-output`, `${value}.`]) {
      expect(build(text, "content")).toBeUndefined()
    }
  })

  it("preserves whitespace boundaries, first spans, repeated calls and encoded content", () => {
    for (const prefix of ["", "hello ", "\r\n\t", "\u00a0"]) {
      const mention = { value, start: prefix.length, end: prefix.length + value.length }
      const expected = {
        mime: "text/plain",
        filename,
        url: "data:text/plain;charset=utf-8,%C3%A9%20%25%26%23%3F%0D%0A",
        source: { type: "file", path: filename, text: mention },
      }
      expect(build(`${prefix}${value} ${value}`, "é %&#?\r\n")).toEqual(expected)
      expect(build(`${prefix}${value}`, "é %&#?\r\n")).toEqual(expected)
    }
  })
})
