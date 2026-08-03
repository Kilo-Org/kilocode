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
    expect(result.omitted).toEqual([])
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
    expect(result.omitted).toEqual([omitted])
    expect(result.output).toContain(omitted)
  })

  test("drops the reminder when no complete content or actionable path notice fits", () => {
    const result = formatInstructionReminder([{ filepath: "/repo/AGENTS.md", content: "instructions" }], {
      maxBytes: 10,
    })

    expect(result).toEqual({ output: "", loaded: [], omitted: ["/repo/AGENTS.md"], truncated: true })
  })

  test("uses the summarized omitted notice when deciding whether content fits", () => {
    const result = formatInstructionReminder(
      [
        { filepath: "/repo/AGENTS.md", content: "root instructions" },
        ...Array.from({ length: 10 }, (_, i) => ({
          filepath: `/repo/pkg/${i}/AGENTS.md`,
          content: "x".repeat(1000),
        })),
      ],
      { maxBytes: 260 },
    )

    expect(result.loaded).toEqual(["/repo/AGENTS.md"])
    expect(result.omitted).toEqual(Array.from({ length: 10 }, (_, i) => `/repo/pkg/${i}/AGENTS.md`))
    expect(result.output).toContain("root instructions")
    expect(result.output).toContain("and 9 more")
    expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(260)
  })

  test("keeps a visible omission notice when paths do not fit", () => {
    const result = formatInstructionReminder(
      [
        { filepath: "/repo/AGENTS.md", content: "root instructions" },
        { filepath: "/repo/" + "deep/".repeat(20) + "AGENTS.md", content: "x".repeat(1000) },
      ],
      { maxBytes: 120 },
    )

    expect(result.loaded).toEqual(["/repo/AGENTS.md"])
    expect(result.omitted.length).toBe(1)
    expect(result.output).toContain("Some instruction files were omitted")
    expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(120)
  })

  test("respects utf-8 byte budgets", () => {
    const result = formatInstructionReminder(
      [
        { filepath: "/repo/AGENTS.md", content: "\u0928\u093f\u092f\u092e" },
        { filepath: "/repo/\u092a\u0948\u0915\u0947\u091c/AGENTS.md", content: "more" },
      ],
      { maxBytes: 180 },
    )

    expect(Buffer.byteLength(result.output, "utf-8")).toBeLessThanOrEqual(180)
  })
})
