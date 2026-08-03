import { describe, expect, test } from "bun:test"
import { formatInstructionReminder } from "@/kilocode/tool/read-instruction-reminder"

describe("formatInstructionReminder", () => {
  test("delivers multiple instruction files when they fit", () => {
    const result = formatInstructionReminder(
      [
        { filepath: "/repo/AGENTS.md", content: "root instructions" },
        { filepath: "/repo/pkg/AGENTS.md", content: "package instructions" },
      ],
      { maxBytes: 1024 },
    )

    expect(result.truncated).toBe(false)
    expect(result.loaded).toEqual(["/repo/AGENTS.md", "/repo/pkg/AGENTS.md"])
    expect(result.output).toContain("root instructions")
    expect(result.output).toContain("package instructions")
  })

  test("omits whole instruction paths instead of slicing a path mid-string", () => {
    const omitted = "/repo/packages/very-long-package-name/AGENTS.md"
    const result = formatInstructionReminder(
      [
        { filepath: "/repo/AGENTS.md", content: "root instructions" },
        { filepath: omitted, content: "x".repeat(4096) },
      ],
      { maxBytes: 360 },
    )

    expect(result.truncated).toBe(true)
    expect(result.loaded).toEqual(["/repo/AGENTS.md"])
    expect(result.output).toContain(omitted)
  })

  test("drops the reminder when no complete content or actionable path notice fits", () => {
    const result = formatInstructionReminder([{ filepath: "/repo/AGENTS.md", content: "instructions" }], {
      maxBytes: 10,
    })

    expect(result).toEqual({ output: "", loaded: [], truncated: true })
  })
})
