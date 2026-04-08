import { describe, expect, test } from "bun:test"
import { TaskResultStatus, Escalation, TeamTaskResult } from "@/devilcode/team/types"

describe("TaskResultStatus", () => {
  test("accepts valid values", () => {
    for (const status of ["completed", "escalated", "blocked", "failed"] as const) {
      expect(TaskResultStatus.parse(status)).toBe(status)
    }
  })

  test("rejects invalid values", () => {
    expect(() => TaskResultStatus.parse("success")).toThrow()
    expect(() => TaskResultStatus.parse("pending")).toThrow()
    expect(() => TaskResultStatus.parse("")).toThrow()
  })
})

describe("Escalation", () => {
  test("parses with all fields", () => {
    const result = Escalation.parse({
      reason: "Too complex for current tier",
      suggestedRole: "senior",
      context: "Requires architectural decision",
    })
    expect(result.reason).toBe("Too complex for current tier")
    expect(result.suggestedRole).toBe("senior")
    expect(result.context).toBe("Requires architectural decision")
  })

  test("parses with optional suggestedRole omitted", () => {
    const result = Escalation.parse({
      reason: "Blocked on dependency",
      context: "Waiting for API schema",
    })
    expect(result.reason).toBe("Blocked on dependency")
    expect(result.suggestedRole).toBeUndefined()
    expect(result.context).toBe("Waiting for API schema")
  })
})

describe("TeamTaskResult", () => {
  test("parses with all fields", () => {
    const result = TeamTaskResult.parse({
      status: "completed",
      output: "Implemented feature X",
      filesModified: ["src/foo.ts", "src/bar.ts"],
      escalation: {
        reason: "Needs review",
        suggestedRole: "orchestrator",
        context: "Architecture concern",
      },
    })
    expect(result.status).toBe("completed")
    expect(result.output).toBe("Implemented feature X")
    expect(result.filesModified).toEqual(["src/foo.ts", "src/bar.ts"])
    expect(result.escalation).toBeDefined()
    expect(result.escalation!.reason).toBe("Needs review")
  })

  test("defaults filesModified to empty array", () => {
    const result = TeamTaskResult.parse({
      status: "completed",
      output: "Done",
    })
    expect(result.filesModified).toEqual([])
  })

  test("parses with escalation present", () => {
    const result = TeamTaskResult.parse({
      status: "escalated",
      output: "Cannot proceed",
      escalation: {
        reason: "Out of scope",
        context: "Requires infrastructure changes",
      },
    })
    expect(result.escalation).toBeDefined()
    expect(result.escalation!.reason).toBe("Out of scope")
    expect(result.escalation!.suggestedRole).toBeUndefined()
  })

  test("parses without escalation (optional field)", () => {
    const result = TeamTaskResult.parse({
      status: "completed",
      output: "All good",
      filesModified: ["readme.md"],
    })
    expect(result.escalation).toBeUndefined()
  })
})
