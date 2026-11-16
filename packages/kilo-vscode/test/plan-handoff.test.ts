import { describe, expect, it } from "bun:test"
import { recordAnswer, takesHandoff } from "../webview-ui/src/v2/plan-handoff"

describe("plan handoff", () => {
  it("opens the new session only in the webview that answered the question", () => {
    recordAnswer("/repo", 1_000)
    expect(takesHandoff("/repo", 2_000)).toBe(true)
    expect(takesHandoff("/other", 2_000)).toBe(false)
  })

  it("opens one session per answer", () => {
    recordAnswer("/repo", 1_000)
    expect(takesHandoff("/repo", 1_500)).toBe(true)
    expect(takesHandoff("/repo", 1_600)).toBe(false)
  })

  it("ignores an answer from long before the handoff", () => {
    recordAnswer("/repo", 1_000)
    expect(takesHandoff("/repo", 1_000 + 60_000)).toBe(false)
  })
})
