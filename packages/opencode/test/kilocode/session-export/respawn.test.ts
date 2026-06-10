import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { SessionExport } from "@/kilocode/session-export"
import { getKillSwitchReason, resetEligibility } from "@/kilocode/session-export/eligibility"

describe("SessionExport worker respawn", () => {
  let feature: string | undefined

  beforeEach(async () => {
    await SessionExport.shutdown()
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

  test("reinitializes capture with latest snapshot provider", async () => {
    const worker = new FakeWorker(0)
    SessionExport.init({
      agentVersion: "v0",
      dbPath: ":memory:",
      subscribeAll: () => () => {},
      createWorker: () => worker as unknown as Worker,
    })
    SessionExport.init({
      agentVersion: "v0",
      dbPath: ":memory:",
      subscribeAll: () => () => {},
      createWorker: () => worker as unknown as Worker,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "snap", files: [] }),
        diff: async () => ({ snapshotHash: "snap", diff: [] }),
      },
    })

    SessionExport.beforeRequest(request("s1"))
    await waitFor(() =>
      worker.messages.some((msg) => msg.kind === "event" && msg.envelope?.type === "workspace_baseline_completed"),
    )

    expect(worker.messages.filter((msg) => msg.kind === "init").length).toBe(1)
  })

  test("keeps snapshot providers scoped by workspace", async () => {
    const worker = new FakeWorker(0)
    SessionExport.init({
      agentVersion: "v0",
      dbPath: ":memory:",
      workspaceKey: "workspace-a",
      subscribeAll: () => () => {},
      createWorker: () => worker as unknown as Worker,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "snap-a", files: [{ path: "a.ts", kind: "file", size: 1 }] }),
        diff: async () => ({ snapshotHash: "snap-a", diff: [] }),
      },
    })
    SessionExport.init({
      agentVersion: "v0",
      dbPath: ":memory:",
      workspaceKey: "workspace-b",
      subscribeAll: () => () => {},
      createWorker: () => worker as unknown as Worker,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "snap-b", files: [{ path: "b.ts", kind: "file", size: 1 }] }),
        diff: async () => ({ snapshotHash: "snap-b", diff: [] }),
      },
    })

    SessionExport.beforeRequest(request("s-a", "workspace-a"))
    SessionExport.beforeRequest(request("s-b", "workspace-b"))
    await waitFor(
      () =>
        worker.messages.filter((msg) => msg.kind === "event" && msg.envelope?.type === "workspace_baseline_completed")
          .length === 2,
    )

    const files = worker.messages
      .filter((msg) => msg.kind === "event" && msg.envelope?.type === "workspace_baseline_completed")
      .map((msg) => msg.envelope?.files?.[0]?.path)
      .sort()
    expect(files).toEqual(["a.ts", "b.ts"])
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

    for (const id of ["s1", "s2", "s3", "s4"]) {
      SessionExport.beforeRequest(request(id))
    }

    expect(getKillSwitchReason()).toBe("worker_respawn_failed")
    expect(workers.filter((worker) => worker.terminated).length).toBeGreaterThanOrEqual(4)
  })
})

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  messages: Array<{ kind?: string; surface?: string; envelope?: { type?: string; files?: Array<{ path?: string }> } }> =
    []

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

function request(sessionId: string, workspaceKey?: string): Parameters<typeof SessionExport.beforeRequest>[0] {
  return {
    input: {
      model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true, providerId: "kilo", modelId: "free-1" },
      org: { type: "personal" },
    },
    requestMeta: {
      sessionId,
      rootSessionId: sessionId,
      requestId: `r-${sessionId}`,
      userMessageId: `u-${sessionId}`,
      agent: "build",
      modeId: "build",
      workspaceKey,
    },
    assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 1_000) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("timed out waiting for condition")
}
