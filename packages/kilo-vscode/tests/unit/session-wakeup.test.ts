import { describe, expect, it } from "bun:test"
import { handleWakeupMessage, wakeups } from "../../webview-ui/src/context/session-wakeup"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages"

function send(message: Record<string, unknown>): boolean {
  return handleWakeupMessage(message as unknown as ExtensionMessage)
}

describe("wakeup store", () => {
  it("tracks a pending count per session", () => {
    send({ type: "sessionWakeup", sessionID: "track-1", pending: 2 })
    send({ type: "sessionWakeup", sessionID: "track-2", pending: 1 })

    expect(wakeups()["track-1"]).toBe(2)
    expect(wakeups()["track-2"]).toBe(1)
  })

  it("clears the state when a wakeup is unscheduled", () => {
    send({ type: "sessionWakeup", sessionID: "clear-1", pending: 3 })
    expect(wakeups()["clear-1"]).toBe(3)

    expect(send({ type: "sessionWakeup", sessionID: "clear-1", pending: 0 })).toBe(true)

    expect(wakeups()["clear-1"]).toBeUndefined()
  })

  it("clears the state when the session is deleted", () => {
    send({ type: "sessionWakeup", sessionID: "deleted-1", pending: 2 })

    expect(send({ type: "sessionDeleted", sessionID: "deleted-1" })).toBe(false)
    expect(wakeups()["deleted-1"]).toBeUndefined()
  })

  it("leaves unrelated messages alone", () => {
    expect(send({ type: "sessionStatus", sessionID: "other-1", status: "busy" })).toBe(false)
  })
})
