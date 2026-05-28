import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SessionExport } from "@/kilocode/session-export"
import { getKillSwitchReason, resetEligibility } from "@/kilocode/session-export/eligibility"

describe("SessionExport worker respawn", () => {
  let feature: string | undefined

  beforeEach(() => {
    feature = process.env.KILOCODE_FEATURE
    resetEligibility()
  })

  afterEach(async () => {
    await SessionExport.shutdown()
    resetEligibility()
    if (feature === undefined) delete process.env.KILOCODE_FEATURE
    else process.env.KILOCODE_FEATURE = feature
  })

  test("passes surface to worker init", () => {
    const workers: FakeWorker[] = []
    process.env.KILOCODE_FEATURE = "cli"
    SessionExport.init({
      agentVersion: "v0",
      dbPath: ":memory:",
      subscribeAll: () => () => {},
      createWorker: () => {
        const worker = new FakeWorker(0)
        workers.push(worker)
        return worker as unknown as Worker
      },
    })

    const init = workers[0].messages.find((msg) => msg.kind === "init")
    expect(init?.surface).toBe("cli")
  })

  test("shutdown catches synchronous worker acknowledgements", async () => {
    SessionExport.init({
      agentVersion: "v0",
      dbPath: ":memory:",
      subscribeAll: () => () => {},
      createWorker: () => new FakeWorker(0) as unknown as Worker,
    })

    const start = performance.now()
    await SessionExport.shutdown()

    expect(performance.now() - start).toBeLessThan(100)
  })

  test("respawns once when worker postMessage fails", () => {
    const workers: FakeWorker[] = []
    SessionExport.init({
      agentVersion: "v0",
      dbPath: ":memory:",
      subscribeAll: () => () => {},
      createWorker: () => {
        const worker = new FakeWorker(workers.length === 0 ? 1 : 0)
        workers.push(worker)
        return worker as unknown as Worker
      },
    })

    SessionExport.beforeRequest(request("s1"))

    expect(workers.length).toBe(2)
    expect(workers[0].terminated).toBe(true)
    expect(workers[1].messages.some((msg) => msg.kind === "init")).toBe(true)
  })

  test("sets kill switch after repeated worker postMessage failures", () => {
    const workers: FakeWorker[] = []
    SessionExport.init({
      agentVersion: "v0",
      dbPath: ":memory:",
      subscribeAll: () => () => {},
      createWorker: () => {
        const worker = new FakeWorker(10)
        workers.push(worker)
        return worker as unknown as Worker
      },
    })

    SessionExport.beforeRequest(request("s1"))
    SessionExport.beforeRequest(request("s2"))

    expect(getKillSwitchReason()).toBe("worker_respawn_failed")
    expect(workers.filter((worker) => worker.terminated).length).toBeGreaterThanOrEqual(4)
  })
})

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  messages: Array<{ kind?: string; surface?: string }> = []

  constructor(private failures: number) {}

  postMessage(msg: { kind?: string }): void {
    this.messages.push(msg)
    if (msg.kind === "event" && this.failures > 0) {
      this.failures--
      throw new Error("post failed")
    }
    if (msg.kind === "shutdown") {
      this.onmessage?.({ data: { kind: "shutdown_done" } } as MessageEvent)
    }
  }

  terminate(): void {
    this.terminated = true
  }
}

function request(sessionId: string): Parameters<typeof SessionExport.beforeRequest>[0] {
  return {
    input: {
      model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true, providerId: "kilo", modelId: "free-1" },
      org: undefined,
    },
    requestMeta: {
      sessionId,
      rootSessionId: sessionId,
      requestId: `r-${sessionId}`,
      userMessageId: `u-${sessionId}`,
      agent: "build",
      modeId: "build",
    },
    assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
  }
}
