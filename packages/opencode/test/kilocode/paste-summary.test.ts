import { describe, expect, it } from "bun:test"
import { shouldSummarize } from "../../src/kilocode/paste-summary"

describe("paste-summary", () => {
  it("does not summarize 4 lines", () => {
    const text = Array.from({ length: 4 }, (_, i) => `line ${i + 1}`).join("\n")
    expect(shouldSummarize(text)).toEqual({ lines: 4, summarize: false })
  })

  it("summarizes 5 lines", () => {
    const text = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n")
    expect(shouldSummarize(text)).toEqual({ lines: 5, summarize: true })
  })

  it("does not summarize 800 chars", () => {
    const text = "a".repeat(800)
    expect(shouldSummarize(text)).toEqual({ lines: 1, summarize: false })
  })

  it("summarizes 801 chars", () => {
    const text = "a".repeat(801)
    expect(shouldSummarize(text)).toEqual({ lines: 1, summarize: true })
  })

  it("summarizes when either threshold triggers independently", () => {
    const lines = Array.from({ length: 5 }, () => "a").join("\n")
    const chars = "b".repeat(801)

    expect(shouldSummarize(lines)).toEqual({ lines: 5, summarize: true })
    expect(shouldSummarize(chars)).toEqual({ lines: 1, summarize: true })
  })

  it("keeps 4 lines and 780 chars expanded", () => {
    const row = "a".repeat(194)
    const text = Array.from({ length: 4 }, () => row).join("\n")

    expect(text.length).toBe(779)
    expect(shouldSummarize(text)).toEqual({ lines: 4, summarize: false })
  })

  it("summarizes 5 lines and 500 chars", () => {
    const row = "b".repeat(96)
    const text = Array.from({ length: 5 }, () => row).join("\n")

    expect(text.length).toBe(484)
    expect(shouldSummarize(text)).toEqual({ lines: 5, summarize: true })
  })
})
