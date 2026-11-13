import { describe, expect, test } from "bun:test"
import { feed } from "../src/services/caffeination/feed"

function scene() {
  const posted: boolean[] = []
  const projection = feed({
    paths: () => ["/repo"],
    watching: () => true,
    load: async () => ({ running: new Set<string>() }),
    post: (busy) => posted.push(busy),
  })
  const send = (type: string, data: Record<string, unknown>) =>
    projection.event({ type, location: { directory: "/repo" }, data })
  return { posted, send, projection }
}

describe("caffeination feed", () => {
  test("keeps a session awake across streaming events and releases it on idle", () => {
    const { posted, send } = scene()

    send("session.status", { sessionID: "ses_1", status: { type: "busy" } })
    expect(posted.at(-1)).toBe(true)

    // Every session event carries a sessionID; a delta must not clear the running state.
    send("session.step.streamed", { sessionID: "ses_1" })
    send("session.tool.started", { sessionID: "ses_1" })
    expect(posted.at(-1)).toBe(true)

    send("session.status", { sessionID: "ses_1", status: { type: "idle" } })
    expect(posted.at(-1)).toBe(false)
  })

  test("holds while a wakeup is pending and releases when it fires", () => {
    const { posted, send } = scene()

    send("rpc.kilocode.wakeup.changed", { sessionID: "ses_1", pending: 1 })
    expect(posted.at(-1)).toBe(true)

    // An idle status does not release a session that still has a scheduled wakeup.
    send("session.status", { sessionID: "ses_1", status: { type: "idle" } })
    expect(posted.at(-1)).toBe(true)

    send("rpc.kilocode.wakeup.changed", { sessionID: "ses_1", pending: 0 })
    expect(posted.at(-1)).toBe(false)
  })

  test("releases a retrying session when its execution finishes", () => {
    const { posted, send } = scene()

    send("session.retry.scheduled", { sessionID: "ses_1" })
    expect(posted.at(-1)).toBe(true)

    send("session.execution.succeeded", { sessionID: "ses_1" })
    expect(posted.at(-1)).toBe(false)
  })
})
