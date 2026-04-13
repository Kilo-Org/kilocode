import { describe, expect, it } from "bun:test"
import {
  createSessionItem,
  createSessionSummary,
  updateSessionSummary,
} from "../../../webview-ui/src/components/migration/session-migration-summary-state"

const session = createSessionItem({
  id: "legacy-1",
  title: "Legacy task",
  directory: "/workspace/testing",
  time: 1,
})

describe("session migration summary state", () => {
  it("moves a session from skipped to imported when a force rerun finishes successfully", () => {
    const skipped = updateSessionSummary(createSessionSummary(), session, "skipped")
    const done = updateSessionSummary(skipped, session, "done")

    expect(done.skipped).toHaveLength(0)
    expect(done.errored).toHaveLength(0)
    expect(done.imported).toEqual([session])
  })

  it("moves a session into errored and removes it from the other buckets", () => {
    const done = updateSessionSummary(createSessionSummary(), session, "done")
    const next = updateSessionSummary(done, { ...session, error: "Boom\nstack" }, "error")

    expect(next.imported).toHaveLength(0)
    expect(next.skipped).toHaveLength(0)
    expect(next.errored).toEqual([{ ...session, error: "Boom\nstack" }])
  })
})
