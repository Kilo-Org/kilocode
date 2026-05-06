// kilocode_change - new file
import { describe, expect, test } from "bun:test"

async function load() {
  const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
  return import(`../../../src/kilocode/cli/cmd/tui/auto-approve?${key}`)
}

describe("tui auto-approve", () => {
  test("boot only enables one startup session", async () => {
    const { TuiAutoApprove } = await load()

    expect(TuiAutoApprove.boot("ses_a")).toBe(true)
    expect(TuiAutoApprove.enabled("ses_a")).toBe(true)
    expect(TuiAutoApprove.boot("ses_b")).toBe(false)
    expect(TuiAutoApprove.enabled("ses_b")).toBe(false)
  })

  test("disabling clears last replied request", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(true)
    TuiAutoApprove.mark("ses_a", "req_1")
    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(false)

    TuiAutoApprove.set("ses_a", false)
    TuiAutoApprove.set("ses_a", true)

    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(true)
  })

  test("reply tracking stays session scoped", async () => {
    const { TuiAutoApprove } = await load()

    TuiAutoApprove.set("ses_a", true)
    TuiAutoApprove.set("ses_b", true)
    TuiAutoApprove.mark("ses_a", "req_1")

    expect(TuiAutoApprove.shouldReply("ses_a", "req_1")).toBe(false)
    expect(TuiAutoApprove.shouldReply("ses_b", "req_1")).toBe(true)
  })
})
