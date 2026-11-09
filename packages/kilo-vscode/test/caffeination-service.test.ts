import { describe, expect, test } from "bun:test"
import type { CaffeinationDriver } from "@kilocode/caffeination"
import { CaffeinationService } from "../src/services/caffeination"

type Connection = ConstructorParameters<typeof CaffeinationService>[0]
type Event = Parameters<Parameters<Connection["onEvent"]>[0]>[0]
type Status = Parameters<Parameters<Connection["onState"]>[0]>[0]

const flush = () => Bun.sleep(0)

function scene() {
  const starts: number[] = []
  const stops: string[] = []
  const events = new Set<(event: Event) => void>()
  const states = new Set<(state: Status) => void>()
  let connection: Status = "connected"
  let active: Record<string, unknown> = {}
  const driver: CaffeinationDriver = {
    available: true,
    start(pid) {
      starts.push(pid)
      return Promise.resolve()
    },
    stop() {
      stops.push("stop")
      return Promise.resolve()
    },
  }
  const service = new CaffeinationService(
    {
      state: () => connection,
      client: async () => ({
        session: {
          list: async () => ({ data: [{ id: "ses_1" }] }),
          active: async () => active,
        },
      }),
      onEvent: (listener: (event: Event) => void) => {
        events.add(listener)
        return () => events.delete(listener)
      },
      onState: (listener: (state: Status) => void) => {
        states.add(listener)
        return () => states.delete(listener)
      },
    } as unknown as Connection,
    () => ["/repo"],
    driver,
  )
  return {
    service,
    starts,
    stops,
    active: (value: Record<string, unknown>) => {
      active = value
    },
    send: (event: Event) => events.forEach((listener) => listener(event)),
    connect: (state: Status) => {
      connection = state
      states.forEach((listener) => listener(state))
    },
  }
}

const status = (type: "busy" | "retry" | "idle") =>
  ({
    type: "session.status",
    location: { directory: "/repo" },
    data: { sessionID: "ses_1", status: { type } },
  }) as unknown as Event

describe("caffeination service", () => {
  test("holds an inhibitor while a session runs and releases it when idle", async () => {
    const app = scene()
    app.active({ ses_1: "busy" })
    await app.service.setEnabled(true)
    expect(app.starts).toEqual([process.pid])

    app.send(status("idle"))
    await flush()
    expect(app.stops).toEqual(["stop"])
    expect(app.service.getState()).toMatchObject({ enabled: true, active: false })
    await app.service.dispose()
  })

  test("disabling releases the inhibitor and enabling reads the current server state", async () => {
    const app = scene()
    await app.service.setEnabled(true)
    expect(app.starts).toEqual([])

    app.active({ ses_1: "retry" })
    await app.service.setEnabled(false)
    await app.service.setEnabled(true)
    expect(app.starts).toEqual([process.pid])

    app.active({})
    app.send(status("idle"))
    await flush()
    expect(app.stops).toEqual(["stop"])
    await app.service.dispose()
  })

  test("a disconnect releases the inhibitor and a reconnect restores it", async () => {
    const app = scene()
    app.active({ ses_1: "busy" })
    await app.service.setEnabled(true)

    app.connect("disconnected")
    await flush()
    expect(app.stops).toEqual(["stop"])
    expect(app.service.getState()).toMatchObject({ enabled: true, active: false })

    app.connect("connected")
    await flush()
    expect(app.starts).toEqual([process.pid, process.pid])
    await app.service.dispose()
  })
})
