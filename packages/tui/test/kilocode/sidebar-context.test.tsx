/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode-ai/plugin/tui/context"
import { SidebarContext } from "../../src/feature-plugins/sidebar/context"

function context(options?: { cost?: number; tokens?: number; percent?: number }) {
  const defaultColor = RGBA.fromInts(200, 200, 200)
  const actionColor = RGBA.fromInts(100, 150, 250)
  return {
    theme: {
      text: {
        default: defaultColor,
        subdued: defaultColor,
        action: {
          secondary: {
            default: actionColor,
          },
        },
      },
    },
    data: {
      session: {
        get: () => ({ location: { directory: "/workspace" } }),
        cost: () => options?.cost ?? 0,
        message: {
          list: () =>
            options?.tokens
              ? [
                  {
                    id: "message",
                    type: "assistant",
                    model: { providerID: "provider", id: "model" },
                    tokens: {
                      input: options.tokens,
                      output: 0,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                ]
              : [],
        },
      },
      location: {
        model: {
          list: () =>
            options?.percent !== undefined && options?.tokens
              ? [
                  {
                    providerID: "provider",
                    id: "model",
                    limit: { context: Math.round(options.tokens / (options.percent / 100)) },
                  },
                ]
              : [],
        },
      },
    },
  } as unknown as Context
}

test("collapsible native Context section defaults to expanded and toggles on click", async () => {
  const ctx = context({ tokens: 1234, cost: 2.5 })
  const app = await testRender(() => <SidebarContext context={ctx} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    const expandedFrame = app.captureCharFrame()
    // Default expanded: shows down triangle and body metrics
    expect(expandedFrame).toContain("▼ Context")
    expect(expandedFrame).toContain("1,234 tokens")
    expect(expandedFrame).toContain("$2.50 spent")

    // Click heading row to collapse
    const lines = expandedFrame.split("\n")
    const rowIndex = lines.findIndex((line) => line.includes("▼ Context"))
    expect(rowIndex).toBeGreaterThanOrEqual(0)
    const colIndex = lines[rowIndex]!.indexOf("▼ Context")
    await app.mockMouse.click(colIndex, rowIndex)
    await app.renderOnce()

    const collapsedFrame = app.captureCharFrame()
    // Collapsed: shows right triangle and hides body metrics
    expect(collapsedFrame).toContain("▶ Context")
    expect(collapsedFrame).not.toContain("1,234 tokens")
    expect(collapsedFrame).not.toContain("$2.50 spent")

    // Click heading row again to re-expand
    const collapsedLines = collapsedFrame.split("\n")
    const collapsedRowIndex = collapsedLines.findIndex((line) => line.includes("▶ Context"))
    expect(collapsedRowIndex).toBeGreaterThanOrEqual(0)
    const collapsedColIndex = collapsedLines[collapsedRowIndex]!.indexOf("▶ Context")
    await app.mockMouse.click(collapsedColIndex, collapsedRowIndex)
    await app.renderOnce()

    const reexpandedFrame = app.captureCharFrame()
    // Re-expanded: shows down triangle and body metrics again
    expect(reexpandedFrame).toContain("▼ Context")
    expect(reexpandedFrame).toContain("1,234 tokens")
    expect(reexpandedFrame).toContain("$2.50 spent")
  } finally {
    app.renderer.destroy()
  }
})
