// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { KilocodeInstruction } from "@/kilocode/session/instruction"

describe("KilocodeInstruction.budget", () => {
  test("keeps all blocks when combined size is within budget", () => {
    const blocks = ["Instructions from: a\nfoo", "Instructions from: b\nbar"]
    expect(KilocodeInstruction.budget(blocks, 1000)).toEqual(blocks)
  })

  test("drops blocks past the budget and appends one summary entry", () => {
    const kept = "Instructions from: /a/AGENTS.md\nfoo"
    const dropped = "Instructions from: /b/AGENTS.md\nbar"
    const result = KilocodeInstruction.budget([kept, dropped], kept.length)
    expect(result).toEqual([kept, `1 instruction file(s) skipped (over ${kept.length}-char budget): /b/AGENTS.md`])
  })

  test("names every skipped file in the summary", () => {
    const blocks = ["Instructions from: /a\nx", "Instructions from: /b\ny", "Instructions from: /c\nz"]
    const result = KilocodeInstruction.budget(blocks, 0)
    expect(result).toEqual(["3 instruction file(s) skipped (over 0-char budget): /a, /b, /c"])
  })

  test("returns nothing for an empty input", () => {
    expect(KilocodeInstruction.budget([], 100)).toEqual([])
  })

  test("defaults to KILO_INSTRUCTIONS_MAX_CHARS when max is omitted", () => {
    const original = process.env["KILO_INSTRUCTIONS_MAX_CHARS"]
    process.env["KILO_INSTRUCTIONS_MAX_CHARS"] = "5"
    try {
      expect(KilocodeInstruction.budget(["Instructions from: /a\nlong content"])).toEqual([
        "1 instruction file(s) skipped (over 5-char budget): /a",
      ])
    } finally {
      if (original === undefined) delete process.env["KILO_INSTRUCTIONS_MAX_CHARS"]
      else process.env["KILO_INSTRUCTIONS_MAX_CHARS"] = original
    }
  })

  test.each(["not-a-number", "", "0", "-5"])(
    "falls back to the default budget when KILO_INSTRUCTIONS_MAX_CHARS is %p",
    (value) => {
      const original = process.env["KILO_INSTRUCTIONS_MAX_CHARS"]
      process.env["KILO_INSTRUCTIONS_MAX_CHARS"] = value
      try {
        expect(KilocodeInstruction.budget(["Instructions from: /a\nfoo"])).toEqual(["Instructions from: /a\nfoo"])
      } finally {
        if (original === undefined) delete process.env["KILO_INSTRUCTIONS_MAX_CHARS"]
        else process.env["KILO_INSTRUCTIONS_MAX_CHARS"] = original
      }
    },
  )

  test("does not crash when a block has no newline", () => {
    expect(KilocodeInstruction.budget(["no newline here"], 0)).toEqual([
      "1 instruction file(s) skipped (over 0-char budget): no newline here",
    ])
  })
})
