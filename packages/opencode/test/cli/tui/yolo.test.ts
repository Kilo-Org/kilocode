// kilocode_change - new file
import { describe, expect, test } from "bun:test"

async function load() {
  const key = JSON.stringify({ time: Date.now(), rand: Math.random() })
  return import(`../../../src/kilocode/cli/cmd/tui/yolo?${key}`)
}

describe("tui yolo", () => {
  test("boot only enables one startup session", async () => {
    const { TuiYolo } = await load()

    expect(TuiYolo.boot("ses_a")).toBe(true)
    expect(TuiYolo.enabled("ses_a")).toBe(true)
    expect(TuiYolo.boot("ses_b")).toBe(false)
    expect(TuiYolo.enabled("ses_b")).toBe(false)
  })

  test("disabling clears last replied request", async () => {
    const { TuiYolo } = await load()

    TuiYolo.set("ses_a", true)
    expect(TuiYolo.shouldReply("ses_a", "req_1")).toBe(true)
    TuiYolo.mark("ses_a", "req_1")
    expect(TuiYolo.shouldReply("ses_a", "req_1")).toBe(false)

    TuiYolo.set("ses_a", false)
    TuiYolo.set("ses_a", true)

    expect(TuiYolo.shouldReply("ses_a", "req_1")).toBe(true)
  })

  test("reply tracking stays session scoped", async () => {
    const { TuiYolo } = await load()

    TuiYolo.set("ses_a", true)
    TuiYolo.set("ses_b", true)
    TuiYolo.mark("ses_a", "req_1")

    expect(TuiYolo.shouldReply("ses_a", "req_1")).toBe(false)
    expect(TuiYolo.shouldReply("ses_b", "req_1")).toBe(true)
  })
})
