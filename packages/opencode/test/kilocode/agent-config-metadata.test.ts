import { describe, expect, test } from "bun:test"
import { processConfigItem } from "../../src/kilocode/agent"

describe("processConfigItem", () => {
  test("lifts legacy options-based metadata to typed fields and strips it", () => {
    const item: { options: Record<string, unknown>; displayName?: string; source?: string } = {
      options: { displayName: "Code Reviewer", source: "organization", reasoningEffort: "high" },
    }
    processConfigItem(item)
    expect(item.displayName).toBe("Code Reviewer")
    expect(item.source).toBe("organization")
    // metadata removed from options, genuine provider options preserved
    expect(item.options).toEqual({ reasoningEffort: "high" })
  })

  test("does not overwrite metadata already set as typed fields", () => {
    const item: { options: Record<string, unknown>; displayName?: string; source?: string } = {
      displayName: "Typed Name",
      source: "organization",
      options: { displayName: "Legacy Name", source: "global" },
    }
    processConfigItem(item)
    expect(item.displayName).toBe("Typed Name")
    expect(item.source).toBe("organization")
    expect(item.options).toEqual({})
  })
})
