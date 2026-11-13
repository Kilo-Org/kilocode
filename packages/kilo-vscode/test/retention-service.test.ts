import { afterEach, describe, expect, test } from "bun:test"
import type { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"
import { RetentionService } from "../src/services/task-cleanup/retention"

type Connection = ConstructorParameters<typeof RetentionService>[0]
type State = ReturnType<Connection["state"]>

const services: RetentionService[] = []
afterEach(() => services.splice(0).forEach((service) => service.dispose()))

// A stand-in for the server's retention RPC: the extension test suite runs no server. The real RPC is exercised end to
// end in packages/kilo-cli/test/retention.test.ts.
function scene(input: { enabled: boolean; state?: State }) {
  const server = { enabled: input.enabled, runs: [] as { force?: boolean }[], fail: false }
  const events = new Set<(event: { type: string }) => void>()
  const states = new Set<(state: State) => void>()
  const logs: string[] = []
  let state: State = input.state ?? "connected"
  const status = (): KiloRetentionRpc.Status => ({ policy: { enabled: server.enabled, maxAgeDays: 30 } })
  const connection = {
    state: () => state,
    client: async () => ({
      rpc: () => ({
        status: async () => {
          if (server.fail) throw new Error("unavailable")
          return status()
        },
        run: async (body: { force?: boolean }) => {
          server.runs.push(body)
          return status()
        },
      }),
    }),
    onEvent: (listener: (event: { type: string }) => void) => {
      events.add(listener)
      return () => void events.delete(listener)
    },
    onState: (listener: (state: State) => void) => {
      states.add(listener)
      return () => void states.delete(listener)
    },
  } as unknown as Connection
  const service = new RetentionService(connection, () => "/repo", (message) => logs.push(message), { first: 20, day: 150 })
  services.push(service)
  return {
    server,
    service,
    logs,
    emit: (type: string) => events.forEach((listener) => listener({ type })),
    connect: (next: State) => {
      state = next
      states.forEach((listener) => listener(next))
    },
  }
}

const settle = () => Bun.sleep(5)

describe("session retention trigger", () => {
  test("a disabled policy arms no timer and never asks for a pass", async () => {
    const s = scene({ enabled: false })
    await settle()
    expect(s.service.armed).toBe(false)
    await Bun.sleep(100)
    expect(s.server.runs).toEqual([])
  })

  test("an enabled policy triggers a first pass soon and then one a day", async () => {
    const s = scene({ enabled: true })
    await settle()
    expect(s.service.armed).toBe(true)
    expect(s.server.runs).toHaveLength(0)
    await Bun.sleep(80)
    // A scheduled trigger never forces: the server keeps its spacing between passes.
    expect(s.server.runs).toEqual([{}])
    await Bun.sleep(150)
    expect(s.server.runs).toHaveLength(2)
    expect(s.service.armed).toBe(true)
  })

  test("a config change arms and disarms the trigger", async () => {
    const s = scene({ enabled: false })
    await settle()
    s.server.enabled = true
    s.emit("config.updated")
    await settle()
    expect(s.service.armed).toBe(true)
    s.server.enabled = false
    s.emit("config.updated")
    await settle()
    expect(s.service.armed).toBe(false)
    await Bun.sleep(100)
    expect(s.server.runs).toEqual([])
  })

  test("waits for the server and stops while it is down", async () => {
    const s = scene({ enabled: true, state: "disconnected" })
    await settle()
    expect(s.service.armed).toBe(false)
    s.connect("connected")
    await settle()
    expect(s.service.armed).toBe(true)
    s.connect("disconnected")
    expect(s.service.armed).toBe(false)
    await Bun.sleep(100)
    expect(s.server.runs).toEqual([])
  })

  test("an unreachable status leaves the trigger off and is logged", async () => {
    const s = scene({ enabled: true, state: "disconnected" })
    s.server.fail = true
    s.connect("connected")
    await settle()
    expect(s.service.armed).toBe(false)
    expect(s.logs).toEqual(["Session retention status failed: Error: unavailable"])
  })

  test("a pass that finds the policy disabled stops the daily trigger", async () => {
    const s = scene({ enabled: true })
    await settle()
    s.server.enabled = false
    await Bun.sleep(80)
    expect(s.server.runs).toHaveLength(1)
    expect(s.service.armed).toBe(false)
  })
})
