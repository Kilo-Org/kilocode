import { describe, expect, test } from "bun:test"
import { createMarkedParser } from "../context/marked"

describe("Markdown strikethrough boundaries", () => {
  test.each(["(~a (~b", "~a (~b", "(~24 GB) and (~5.7 GB)", "(~/.config) and (~/.cache)"])(
    "preserves parenthesized tildes in %s",
    async (text) => {
      const parser = createMarkedParser({})
      const html = await Promise.resolve(parser.parse(text))

      expect(html).not.toContain("<del>")
      expect(html).toContain(text)
    },
  )

  test.each([
    ["~removed~", "<del>removed</del>"],
    ["~~removed~~", "<del>removed</del>"],
    ["(~removed~)", "(<del>removed</del>)"],
  ])("keeps valid strikethrough syntax in %s", async (text, expected) => {
    const parser = createMarkedParser({})
    const html = await Promise.resolve(parser.parse(text))

    expect(html).toContain(expected)
  })
})
