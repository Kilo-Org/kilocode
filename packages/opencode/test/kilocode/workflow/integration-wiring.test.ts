// packages/opencode/test/kilocode/workflow/integration-wiring.test.ts
import { describe, test, expect } from "bun:test"
import type { Tool } from "@/tool/tool"

describe("Gap 7: Tool.Context teamRole typing", () => {
  test("Tool.Context type includes teamRole field", () => {
    const ctx: Partial<Tool.Context> = {
      sessionID: "s1",
      messageID: "m1",
      agent: "coder",
      teamRole: "senior",
    }
    expect(ctx.teamRole).toBe("senior")
  })

  test("Tool.Context teamRole is optional (undefined when not set)", () => {
    const ctx: Partial<Tool.Context> = {
      sessionID: "s1",
      messageID: "m1",
      agent: "coder",
    }
    expect(ctx.teamRole).toBeUndefined()
  })
})
