import { describe, expect, test } from "bun:test"
import { sendBinding } from "../webview-ui/src/v2/send-binding"

const base = {
  pinned: "ses_a",
  active: "ses_a",
  running: true,
  mode: "steer" as const,
}

describe("sendBinding", () => {
  test("admits a steer for the next step without interrupting the current call or its tools", () => {
    expect(sendBinding(base)).toEqual({ same: true, delivery: "steer", interrupt: false })
  })

  test("queues for the next turn without interrupting", () => {
    expect(sendBinding({ ...base, mode: "queue" })).toEqual({ same: true, delivery: "queue", interrupt: false })
  })

  test("send now delivers normally when the session has already stopped", () => {
    expect(sendBinding({ ...base, mode: "now", running: false })).toEqual({
      same: true,
      delivery: "steer",
      interrupt: false,
    })
  })

  test("stop and send still stops a pinned session after a tab switch", () => {
    expect(sendBinding({ ...base, active: "ses_b", mode: "now" })).toEqual({
      same: false,
      delivery: "steer",
      interrupt: true,
    })
  })

  test("a steer after a tab switch waits on the session it was sent to", () => {
    expect(sendBinding({ ...base, active: "ses_b" })).toEqual({ same: false, delivery: "steer", interrupt: false })
  })
})
