import { describe, expect, test } from "bun:test"
import { createCostAlert, createCostAlerts, type CostAlert, type CostAlertChoice } from "../src/cost-alert"

function setup() {
  const shown: CostAlert[] = []
  const replies: ((choice: CostAlertChoice) => void)[] = []
  const stopped: string[] = []
  const errors: unknown[] = []
  const stopErrors: unknown[] = []
  const alert = createCostAlert({
    notify: (value) => {
      shown.push(value)
      return new Promise((resolve) => replies.push(resolve))
    },
    stop: async (sessionID) => void stopped.push(sessionID),
    onError: (error) => errors.push(error),
    onStopError: (sessionID, error) => stopErrors.push({ sessionID, error }),
  })
  return { alert, shown, replies, stopped, errors, stopErrors }
}

describe("session cost alert", () => {
  test("disables invalid thresholds and alerts once at equality per session", () => {
    const { alert, shown } = setup()
    alert.track("one")
    alert.update("one", 5)
    alert.setLimit(-1)
    alert.setLimit(Number.NaN)
    expect(shown).toEqual([])
    alert.setLimit(5)
    alert.update("one", 6)
    alert.track("two")
    alert.update("two", 4.99)
    expect(shown).toHaveLength(1)
    alert.update("two", 5)
    expect(shown.map((value) => [value.sessionID, value.cost, value.limit])).toEqual([
      ["one", 5, 5],
      ["two", 5, 5],
    ])
  })

  test("ignores sessions that are neither opened nor running", () => {
    const { alert, shown } = setup()
    alert.setLimit(1)
    alert.update("unknown", 5)
    alert.setLimit(2)
    expect(alert.ids()).toEqual([])
    expect(shown).toEqual([])
    alert.track("opened")
    alert.update("opened", 2)
    expect(shown.map((value) => value.sessionID)).toEqual(["opened"])
  })

  test("continues once per session and threshold, including fractional dollars", async () => {
    const { alert, shown, replies } = setup()
    alert.setLimit(0.000001)
    alert.track("one")
    alert.update("one", 0.000001)
    replies[0]("continue")
    await Promise.resolve()
    alert.rearm("one")
    alert.update("one", 0.000002)
    expect(shown).toHaveLength(1)
    alert.setLimit(0.000002)
    expect(shown).toHaveLength(2)
    replies[1]("continue")
    await Promise.resolve()
    alert.setLimit(0)
    alert.setLimit(0.000001)
    expect(shown).toHaveLength(2)
  })

  test("stop targets the alert session, rearms, and survives archival while pending", async () => {
    const { alert, shown, replies, stopped } = setup()
    alert.setLimit(1)
    alert.track("one")
    alert.track("two")
    alert.update("one", 1)
    alert.update("two", 1)
    alert.rearm("two")
    expect(shown).toHaveLength(2)
    replies[0]("stop")
    await Promise.resolve()
    expect(stopped).toEqual(["one"])
    alert.rearm("one")
    expect(shown.map((value) => value.sessionID)).toEqual(["one", "two", "one"])
    alert.forget("two")
    replies[1]("stop")
    await Promise.resolve()
    await Promise.resolve()
    expect(stopped).toEqual(["one", "two"])
    expect(alert.ids()).toEqual(["one"])
  })

  test("keeps a visible alert actionable when the threshold changes", async () => {
    const { alert, shown, replies, stopped } = setup()
    alert.setLimit(1)
    alert.track("one")
    alert.update("one", 1)
    alert.setLimit(2)
    alert.update("one", 2)
    expect(shown).toHaveLength(1)
    replies[0]("continue")
    await Promise.resolve()
    expect(shown[1].limit).toBe(2)
    replies[1]("stop")
    await Promise.resolve()
    expect(stopped).toEqual(["one"])
    expect(shown).toHaveLength(2)
  })

  test("rearms a dismissed alert on the next execution", async () => {
    const { alert, shown, replies } = setup()
    alert.setLimit(1)
    alert.track("one")
    alert.update("one", 1)
    replies[0](undefined)
    await Promise.resolve()
    alert.update("one", 2)
    expect(shown).toHaveLength(1)
    alert.rearm("one")
    expect(shown).toHaveLength(2)
  })

  test("does not replace a newer usage event with an older session snapshot", () => {
    const { alert, shown } = setup()
    alert.setLimit(2)
    alert.track("one")
    alert.update("one", 1)
    alert.update("one", 0.5)
    alert.setLimit(1)
    expect(shown[0].cost).toBe(1)
  })

  test("reports a failed stop and allows a later usage update to alert again", async () => {
    const replies: ((choice: CostAlertChoice) => void)[] = []
    const failures: string[] = []
    const alert = createCostAlert({
      notify: () => new Promise((resolve) => replies.push(resolve)),
      stop: async () => {
        throw new Error("offline")
      },
      onError: () => {},
      onStopError: (sessionID) => failures.push(sessionID),
    })
    alert.setLimit(1)
    alert.track("one")
    alert.update("one", 1)
    replies[0]("stop")
    await Promise.resolve()
    await Promise.resolve()
    expect(failures).toEqual(["one"])
    alert.update("one", 2)
    expect(replies).toHaveLength(2)
  })
})

test("reconnects active sessions and keeps a pending Stop actionable", async () => {
  const stream = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
  const reconnected = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
  const recovered = Promise.withResolvers<CostAlert>()
  const recoveredAgain = Promise.withResolvers<CostAlert>()
  const live = Promise.withResolvers<CostAlert>()
  const liveSynced = Promise.withResolvers<void>()
  const liveResynced = Promise.withResolvers<void>()
  const liveChoice = Promise.withResolvers<CostAlertChoice>()
  const interrupted = Promise.withResolvers<string>()
  const errors: unknown[] = []
  let streams = 0
  let recoveries = 0
  let liveAlerts = 0
  let liveGets = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.headers.get("authorization") !== "Bearer test") return new Response(null, { status: 401 })
      const path = new URL(request.url).pathname
      if (path === "/api/event")
        return new Response(new ReadableStream({ start: (controller) => (streams++ ? reconnected : stream).resolve(controller) }), {
          headers: { "content-type": "text/event-stream" },
        })
      if (path === "/api/session/active") return Response.json({ data: { ses_recovered: {} } })
      if (path === "/api/session/ses_recovered") return Response.json({ data: { cost: 1, title: "Fixture" } })
      if (path === "/api/session/ses_live") {
        liveGets++ === 0 ? liveSynced.resolve() : liveResynced.resolve()
        return Response.json({ data: { cost: 1.5, title: "Renamed fixture" } })
      }
      if (path === "/api/session/ses_live/interrupt") {
        interrupted.resolve(path)
        return Response.json({ interrupted: true })
      }
      return new Response(null, { status: 404 })
    },
  })
  const alerts = createCostAlerts({
    notify: async (value) => {
      if (value.sessionID === "ses_recovered") {
        if (recoveries++ === 0) {
          recovered.resolve(value)
          return undefined
        }
        recoveredAgain.resolve(value)
        return "continue"
      }
      liveAlerts++
      live.resolve(value)
      return liveChoice.promise
    },
    onError: (error) => errors.push(error),
    onStopError: (_sessionID, error) => errors.push(error),
  })
  try {
    alerts.setLimit(1)
    alerts.start({ url: server.url.toString(), authorization: "Bearer test" })
    const controller = await stream.promise
    const send = (target: ReadableStreamDefaultController<Uint8Array>, event: unknown) =>
      target.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    send(controller, { type: "server.connected", data: {} })
    expect(await recovered.promise).toMatchObject({ sessionID: "ses_recovered", cost: 1, title: "Fixture" })
    await Promise.resolve()
    send(controller, { type: "session.execution.started", data: { sessionID: "ses_live" } })
    await liveSynced.promise
    expect(await live.promise).toMatchObject({ sessionID: "ses_live", cost: 1.5, title: "Renamed fixture" })
    send(controller, { type: "session.renamed", data: { sessionID: "ses_live", title: "Renamed fixture" } })
    send(controller, { type: "session.usage.updated", data: { sessionID: "ses_live", cost: 1.5 } })
    alerts.stop()
    alerts.start({ url: server.url.toString(), authorization: "Bearer test" })
    const next = await reconnected.promise
    send(next, { type: "server.connected", data: {} })
    expect(await recoveredAgain.promise).toMatchObject({ sessionID: "ses_recovered", cost: 1 })
    await liveResynced.promise
    expect(liveAlerts).toBe(1)
    send(next, { type: "session.archived", data: { sessionID: "ses_live" } })
    send(next, { type: "session.usage.updated", data: { sessionID: "ses_live", cost: 2 } })
    await Promise.resolve()
    expect(liveAlerts).toBe(1)
    liveChoice.resolve("stop")
    expect(await interrupted.promise).toBe("/api/session/ses_live/interrupt")
    expect(errors).toEqual([])
  } finally {
    alerts.dispose()
    server.stop(true)
  }
}, 10_000)
