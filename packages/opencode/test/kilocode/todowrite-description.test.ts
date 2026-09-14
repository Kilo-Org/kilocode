import { describe, expect, test } from "bun:test"
import DESCRIPTION_WRITE from "../../src/tool/todowrite.txt"

describe("todowrite description", () => {
  test("tracks milestones without requiring updates for routine actions", () => {
    expect(DESCRIPTION_WRITE).toContain("Track meaningful milestones rather than individual tool calls")
    expect(DESCRIPTION_WRITE).toContain("routine intermediate actions do not need separate updates")
    expect(DESCRIPTION_WRITE).not.toContain("When in doubt, use it")
  })

  test("preserves truthful completion and a single active milestone", () => {
    expect(DESCRIPTION_WRITE).toContain("Keep exactly one `in_progress` while work remains")
    expect(DESCRIPTION_WRITE).toContain("Mark `completed` only after the required work is actually done")
    expect(DESCRIPTION_WRITE).toContain("including any required verification")
    expect(DESCRIPTION_WRITE).toContain("reconcile the list with what was actually completed or remains blocked")
  })
})
