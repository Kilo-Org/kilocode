import { describe, expect, test } from "bun:test"
import { sendBinding } from "../webview-ui/src/v2/send-binding"

const base = {
  pinned: "ses_a",
  active: "ses_a",
  running: true,
  goalActive: false,
  steerInterrupts: true,
  mode: "steer" as const,
}

describe("sendBinding", () => {
  test("steers by stopping the run of the session the send came from", () => {
    expect(sendBinding(base)).toEqual({ same: true, interrupt: true })
  })

  test("keeps an active goal running instead of stopping it", () => {
    expect(sendBinding({ ...base, goalActive: true })).toEqual({ same: true, interrupt: false })
  })

  test("does nothing when the pinned session is not running", () => {
    expect(sendBinding({ ...base, running: false })).toEqual({ same: true, interrupt: false })
  })

  test("stop and send still stops a pinned session after a tab switch", () => {
    expect(sendBinding({ ...base, active: "ses_b", mode: "now" })).toEqual({ same: false, interrupt: true })
  })

  test("a steer after a tab switch waits, because another session's goal is not readable", () => {
    expect(sendBinding({ ...base, active: "ses_b" })).toEqual({ same: false, interrupt: false })
  })
})
