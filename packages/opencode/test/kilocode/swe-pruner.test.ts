import { describe, expect, test } from "bun:test"
import { SwePruner } from "../../src/kilocode/swe-pruner"

describe("SwePruner.question", () => {
  test("extracts a non-empty focus question from raw args", () => {
    expect(SwePruner.question({ filePath: "/a", context_focus_question: "How is auth handled?" })).toBe(
      "How is auth handled?",
    )
  })

  test("returns undefined for missing, empty, or non-string values", () => {
    expect(SwePruner.question({ filePath: "/a" })).toBeUndefined()
    expect(SwePruner.question({ context_focus_question: "   " })).toBeUndefined()
    expect(SwePruner.question({ context_focus_question: 42 })).toBeUndefined()
    expect(SwePruner.question(undefined)).toBeUndefined()
    expect(SwePruner.question(null)).toBeUndefined()
  })
})

describe("SwePruner.prunable", () => {
  test("only read and grep are prunable", () => {
    expect(SwePruner.prunable("read")).toBe(true)
    expect(SwePruner.prunable("grep")).toBe(true)
    expect(SwePruner.prunable("bash")).toBe(false)
    expect(SwePruner.prunable("edit")).toBe(false)
  })
})

describe("SwePruner.extend", () => {
  test("adds the focus parameter without mutating the input schema", () => {
    const schema = {
      type: "object" as const,
      properties: { filePath: { type: "string" as const } },
      required: ["filePath"],
    }
    const extended = SwePruner.extend(schema)
    expect(extended.properties?.[SwePruner.PARAMETER]).toMatchObject({ type: "string" })
    expect(extended.required).toEqual(["filePath"])
    expect(schema.properties).not.toHaveProperty(SwePruner.PARAMETER)
  })

  test("leaves non-object schemas untouched", () => {
    const schema = { type: "string" as const }
    expect(SwePruner.extend(schema)).toBe(schema)
  })
})

describe("SwePruner.parse", () => {
  test("parses ranges and singles, clamps, sorts, and merges", () => {
    const ranges = SwePruner.parse("40-60\n10-20\n12\n62", 100)
    expect(ranges).toEqual([
      [1, 5],
      [10, 20],
      [40, 62],
      [96, 100],
    ])
  })

  test("always keeps head and tail lines", () => {
    const ranges = SwePruner.parse("50-55", 100)
    expect(ranges?.[0]).toEqual([1, 5])
    expect(ranges?.[ranges.length - 1]).toEqual([96, 100])
  })

  test("returns undefined for ALL or unparseable replies", () => {
    expect(SwePruner.parse("ALL", 100)).toBeUndefined()
    expect(SwePruner.parse("all of it is relevant", 100)).toBeUndefined()
    expect(SwePruner.parse("nothing useful here", 100)).toBeUndefined()
    expect(SwePruner.parse("", 100)).toBeUndefined()
  })

  test("drops ranges entirely out of bounds and clamps partial overlaps", () => {
    expect(SwePruner.parse("200-300", 100)).toBeUndefined()
    const ranges = SwePruner.parse("90-300", 100)
    expect(ranges?.[ranges.length - 1]).toEqual([90, 100])
  })

  test("tolerates reversed bounds and bulleted lists", () => {
    const ranges = SwePruner.parse("- 60-40\n* 70", 100)
    expect(ranges).toContainEqual([40, 60])
  })

  test("parses comma-separated ranges on a single line", () => {
    const ranges = SwePruner.parse("10-20, 30-40; 50", 100)
    expect(ranges).toContainEqual([10, 20])
    expect(ranges).toContainEqual([30, 40])
    expect(ranges).toContainEqual([50, 50])
  })

  test("treats comma-separated singles as singles, not a range", () => {
    const ranges = SwePruner.parse("10, 20", 100)
    expect(ranges).toContainEqual([10, 10])
    expect(ranges).toContainEqual([20, 20])
    expect(ranges).not.toContainEqual([10, 20])
  })

  test("tolerates JSON-style array replies", () => {
    const ranges = SwePruner.parse("[[10, 12], [30, 33]]", 100)
    expect(ranges).toContainEqual([10, 12])
    expect(ranges).toContainEqual([30, 33])
  })
})

describe("SwePruner.assemble", () => {
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)

  test("keeps selected ranges and marks omitted sections", () => {
    const output = SwePruner.assemble(
      lines,
      [
        [1, 3],
        [10, 12],
      ],
      20,
    )
    expect(output).toContain("line 1")
    expect(output).toContain("line 12")
    expect(output).not.toContain("line 5\n")
    expect(output).toContain("[6 lines omitted by SWE-Pruner]")
    expect(output).toContain("[8 lines omitted by SWE-Pruner]")
    expect(output.startsWith("[SWE-Pruner: kept 6 of 20 output lines")).toBe(true)
  })

  test("adds no trailing marker when the last range reaches the end", () => {
    const output = SwePruner.assemble(lines, [[18, 20]], 20)
    expect(output.endsWith("line 20")).toBe(true)
  })
})

describe("SwePruner.kept", () => {
  test("sums inclusive range sizes", () => {
    expect(
      SwePruner.kept([
        [1, 5],
        [10, 10],
      ]),
    ).toBe(6)
  })
})
