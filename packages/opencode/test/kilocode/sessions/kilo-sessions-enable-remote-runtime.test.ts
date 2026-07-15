import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { tmpdir } from "../../fixture/fixture"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import { KiloSessions } from "../../../src/kilo-sessions/kilo-sessions"
import { provide } from "../../../src/kilocode/instance"
import { Bus } from "../../../src/bus"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RemoteWS } from "../../../src/kilo-sessions/remote-ws"
import { RemoteSender } from "../../../src/kilo-sessions/remote-sender"
import type { RemoteRuntime } from "../../../src/kilo-sessions/remote-runtime"

type HeartbeatPayload = {
  sessions: Array<{ id: string; status: string; title: string }>
  runtime?: {
    runtimeId: string
    connectionId: string
    protocolVersion: 1
    cliVersion: string
    displayName: string
    projectName: string
    capabilities: string[]
  }
}

type GetSessionsFn = () => Promise<HeartbeatPayload>

let capturedGetSessions: GetSessionsFn | undefined
let capturedRuntime: RemoteRuntime.Interface | undefined
let capturedSender: RemoteSender.Sender | undefined
const sentMessages: unknown[] = []

// Save the real implementations at module load time and restore them after each
// test. This avoids relying on mock.restore() which can leak across test files
// in the same Bun worker.
const realConnect = RemoteWS.connect
const realRemoteSenderCreate = RemoteSender.create

beforeEach(() => {
  capturedGetSessions = undefined
  capturedRuntime = undefined
  capturedSender = undefined
  sentMessages.length = 0
  process.env["KILO_DISABLE_SESSION_INGEST"] = "0"
  process.env["KILO_API_KEY"] = "tok"
  delete process.env["KILO_SESSION_INGEST_URL"]

  spyOn(Bus, "publish").mockResolvedValue(undefined as never)

  globalThis.fetch = (async () => {
    return new Response(null, { status: 200 })
  }) as unknown as typeof fetch

  clearInFlightCache("kilo-sessions:token")
  clearInFlightCache("kilo-sessions:token-valid:tok")

  // Install the mock directly on the namespace.
  ;(RemoteWS as unknown as { connect: typeof realConnect }).connect = ((options: never) => {
    capturedGetSessions = (options as { getSessions: GetSessionsFn }).getSessions
    const conn = {
      connectionId: "mock-conn",
      send: (msg: unknown) => {
        sentMessages.push(msg)
      },
      heartbeat: () => Promise.resolve(),
      heartbeatAcknowledged: () => Promise.resolve(),
      close: () => {},
      get connected() {
        return true
      },
    }
    return conn
  }) as unknown as typeof realConnect

  spyOn(RemoteSender, "create").mockImplementation((options: any) => {
    capturedRuntime = options.runtime as RemoteRuntime.Interface
    const sender = realRemoteSenderCreate(options)
    capturedSender = sender
    return sender
  })
})

afterEach(() => {
  // Always restore the real implementations so subsequent test files see the
  // un-mocked implementations.
  ;(RemoteWS as unknown as { connect: typeof realConnect }).connect = realConnect
  ;(RemoteSender as unknown as { create: typeof realRemoteSenderCreate }).create = realRemoteSenderCreate
})

async function until(predicate: () => boolean, timeout = 1000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("condition never became true")
    await Bun.sleep(10)
  }
}

async function runInIsolatedContext<T>(fn: (tmpPath: string) => Promise<T>): Promise<T> {
  await using tmp = await tmpdir({ git: true })
  let result: T | undefined
  await provide({
    directory: tmp.path,
    fn: async () => {
      try {
        result = await fn(tmp.path)
      } finally {
        try {
          KiloSessions.disableRemote()
        } catch {
          // Swallow — no remote was enabled.
        }
      }
    },
  })
  return result as T
}

describe("KiloSessions.enableRemote — runtime presence wiring", () => {
  test("enableRemote generates one runtimeId per process and includes it in the heartbeat", async () => {
    let payload: HeartbeatPayload | undefined
    await runInIsolatedContext(async () => {
      await KiloSessions.enableRemote()
      payload = await capturedGetSessions!()
    })

    expect(payload).toBeDefined()
    expect(payload!.runtime).toBeDefined()
    const runtime = payload!.runtime!
    expect(runtime.runtimeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(runtime.protocolVersion).toBe(1)
    expect(runtime.cliVersion).toBe(InstallationVersion)
    expect(runtime.capabilities).toEqual(["catalog.v1", "create-and-run.v1"])
    expect(runtime.projectName.length).toBeGreaterThan(0)
    expect(runtime.displayName.length).toBeGreaterThan(0)
  })

  test("runtimeId is stable across all heartbeat calls in the same process", async () => {
    const ids: string[] = []
    await runInIsolatedContext(async () => {
      await KiloSessions.enableRemote()
      ids.push((await capturedGetSessions!()).runtime!.runtimeId)
      ids.push((await capturedGetSessions!()).runtime!.runtimeId)
      ids.push((await capturedGetSessions!()).runtime!.runtimeId)
    })

    expect(ids.length).toBe(3)
    expect(ids[0]).toBe(ids[1])
    expect(ids[1]).toBe(ids[2])
  })

  test("absolute launch directory never appears in the heartbeat payload", async () => {
    let payload: HeartbeatPayload | undefined
    let tmpPath: string | undefined
    await using tmp = await tmpdir({ git: true })
    tmpPath = tmp.path
    await provide({
      directory: tmp.path,
      fn: async () => {
        try {
          await KiloSessions.enableRemote()
          payload = await capturedGetSessions!()
        } finally {
          try {
            KiloSessions.disableRemote()
          } catch {
            // ignore
          }
        }
      },
    })

    expect(payload).toBeDefined()
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain(tmpPath!)
    expect(payload!.runtime!.projectName).not.toMatch(/[/\\]/)
    expect(payload!.runtime!.displayName).not.toMatch(/[/\\]/)
  })

  test("enableRemote wires the same runtime instance to the sender for sessionless get_catalog", async () => {
    await runInIsolatedContext(async (tmpPath) => {
      await KiloSessions.enableRemote()

      expect(capturedRuntime).toBeDefined()
      expect(capturedRuntime!.directory).toBe(tmpPath)
      expect(capturedSender).toBeDefined()

      // The catalog is computed in the captured launch directory using the
      // real Provider and Agent services; no session is created.
      const catalog = await capturedRuntime!.catalog({ protocolVersion: 1 })
      expect(catalog.protocolVersion).toBe(1)
      expect(catalog.agents.length).toBeGreaterThan(0)
      expect(catalog.defaultAgent).toBeTruthy()

      // get_catalog flows through the same runtime instance and does not
      // require a sessionId.
      capturedSender!.handle({
        type: "command",
        id: "req_catalog",
        command: "get_catalog",
        data: { protocolVersion: 1 },
      })
      await until(
        () => sentMessages.some((msg: any) => msg.type === "response" && msg.id === "req_catalog"),
        1000,
      )

      const response = sentMessages.find(
        (msg: any) => msg.type === "response" && msg.id === "req_catalog",
      )
      expect(response).toBeDefined()
      expect((response as any).error).toBeUndefined()
      expect((response as any).result.protocolVersion).toBe(1)
      expect((response as any).result.agents).toEqual(catalog.agents)
      expect((response as any).result.defaultAgent).toBe(catalog.defaultAgent)
    })
  })
})
