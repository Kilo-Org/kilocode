import { expect, test } from "bun:test"
import { CodeRenderable, SyntaxStyle } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { liveAssistantMarkdown, liveReasoningCode } from "../../src/kilocode/live-output"

test("OpenTUI streaming with hidden unstyled text freezes later content", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  try {
    const code = new CodeRenderable(setup.renderer, {
      content: "first",
      filetype: "markdown",
      syntaxStyle: SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }),
      drawUnstyledText: false,
      streaming: true,
    })
    setup.renderOnce()
    expect(code.plainText).toContain("first")
    code.content = "first\nsecond"
    setup.renderOnce()
    expect(code.plainText).not.toContain("second")
  } finally {
    setup.renderer.destroy()
  }
})

test("live reasoning props keep later content visible", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24, useThread: false })
  try {
    const code = new CodeRenderable(setup.renderer, {
      content: "first",
      filetype: "markdown",
      syntaxStyle: SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } }),
      ...liveReasoningCode(false),
    })
    setup.renderOnce()
    code.content = "first\nsecond"
    setup.renderOnce()
    expect(code.plainText).toContain("second")
  } finally {
    setup.renderer.destroy()
  }
})

test("live assistant markdown streams until done", () => {
  expect(liveAssistantMarkdown(false)).toEqual({ streaming: true })
  expect(liveAssistantMarkdown(true)).toEqual({ streaming: false })
})
