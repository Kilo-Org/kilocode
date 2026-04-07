import { describe, it, expect } from "vitest"
import { sizes, MAX_HEIGHT } from "../../webview-ui/src/utils/timeline/sizes"
import type { Part, TextPart, ToolPart, StepFinishPart } from "../../webview-ui/src/types/messages"

function mkText(text: string): TextPart {
  return { id: `t-${text.length}`, type: "text", text }
}

function mkTool(name: string, input: Record<string, unknown> = {}, output = ""): ToolPart {
  return {
    id: `tool-${name}`,
    type: "tool",
    tool: name,
    state: { status: "completed", input, output, title: name },
  }
}

function mkStepFinish(input = 100, output = 50): StepFinishPart {
  return {
    id: "sf",
    type: "step-finish",
    reason: "done",
    tokens: { input, output },
  }
}

describe("timeline sizes", () => {
  it("returns empty array for empty input", () => {
    expect(sizes([])).toEqual([])
  })

  it("returns one entry per part", () => {
    const parts: Part[] = [mkText("a"), mkText("bb"), mkText("ccc")]
    const result = sizes(parts)
    expect(result).toHaveLength(3)
  })

  it("all bars have uniform width", () => {
    const parts: Part[] = [mkText("short"), mkText("a".repeat(500)), mkText("medium")]
    const result = sizes(parts)
    const w = result[0]!.width
    for (const bar of result) {
      expect(bar.width).toBe(w)
    }
  })

  it("height stays within bounds", () => {
    const parts: Part[] = [mkText("short"), mkText("a".repeat(500)), mkText("medium length text")]
    const result = sizes(parts)
    for (const bar of result) {
      expect(bar.height).toBeGreaterThanOrEqual(8)
      expect(bar.height).toBeLessThanOrEqual(MAX_HEIGHT)
    }
  })

  it("larger content produces taller bars", () => {
    const parts: Part[] = [mkText("x"), mkText("x".repeat(1000))]
    const result = sizes(parts)
    expect(result[1]!.height).toBeGreaterThan(result[0]!.height)
  })

  it("handles tool parts with input/output content", () => {
    const parts: Part[] = [
      mkTool("bash", { command: "ls" }, "file1\nfile2\nfile3"),
      mkTool("read", { path: "README.md" }, "a".repeat(200)),
    ]
    const result = sizes(parts)
    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBeGreaterThan(0)
    expect(result[1]!.content).toBeGreaterThan(result[0]!.content)
  })

  it("handles step-finish parts using token counts", () => {
    const parts: Part[] = [mkStepFinish(1000, 500), mkStepFinish(100, 50)]
    const result = sizes(parts)
    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBeGreaterThan(result[1]!.content)
  })

  it("handles single-part input without crashing", () => {
    const result = sizes([mkText("only one")])
    expect(result).toHaveLength(1)
  })

  it("returns integer values for height", () => {
    const parts: Part[] = [mkText("a"), mkText("bb"), mkText("ccc"), mkText("dddd")]
    const result = sizes(parts)
    for (const bar of result) {
      expect(Number.isInteger(bar.height)).toBe(true)
    }
  })
})
