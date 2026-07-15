import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { tmpdir } from "../../fixture/fixture"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import { KiloSessions } from "../../../src/kilo-sessions/kilo-sessions"
import { provide } from "../../../src/kilocode/instance"
import { Bus } from "../../../src/bus"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RemoteWS } from "../../../src/kilo-sessions/remote-ws"

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

// Save the real connect at module load time and restore it after each test.
// This avoids relying on mock.restore() which can leak across test files
// in the same Bun worker.
const realConnect = RemoteWS.connect

beforeEach(() => {
  capturedGetSessions = undefined
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
    return {
      connectionId: "mock-conn",
      send: () => {},
      heartbeat: () => Promise.resolve(),
      heartbeatAcknowledged: () => Promise.resolve(),
      close: () => {},
      get connected() {
        return true
      },
    }
  }) as unknown as typeof realConnect
})

afterEach(() => {
  // Always restore the real connect so subsequent test files see the
  // un-mocked implementation.
  ;(RemoteWS as unknown as { connect: typeof realConnect }).connect = realConnect
})

async function runInIsolatedContext(fn: () => Promise<void>): Promise<void> {
  await using tmp = await tmpdir({ git: true })
  await provide({
    directory: tmp.path,
    fn: async () => {
      try {
        await fn()
      } finally {
        try {
          KiloSessions.disableRemote()
        } catch {
          // Swallow — no remote was enabled.
        }
      }
    },
  })
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
})
