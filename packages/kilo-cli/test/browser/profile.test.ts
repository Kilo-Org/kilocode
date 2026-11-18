// A selected browser profile constrains the extension, not only the hub the client dialled: an extension that
// reconnects as another profile must not serve the session's tabs.
import { describe, expect, test } from "bun:test"
import { accepts } from "../../src/browser/client"

describe("browser profile selection", () => {
  test("without a selection any connected profile is served", () => {
    expect(accepts(undefined, { profileLabel: "Default" })).toBe(true)
    expect(accepts(undefined, { profileLabel: "Work" })).toBe(true)
  })

  test("a selection accepts only the profile it names", () => {
    expect(accepts("Work", { profileLabel: "Work" })).toBe(true)
    expect(accepts("Work", { profileLabel: "Default" })).toBe(false)
  })
})
