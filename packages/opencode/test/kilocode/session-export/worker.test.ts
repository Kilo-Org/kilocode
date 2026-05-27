import { describe, test, expect } from "bun:test"

describe("worker entry", () => {
  test("processes a posted event end-to-end", async () => {
    const worker = new Worker(new URL("../../../src/kilocode/session-export/worker.ts", import.meta.url))
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker ready timeout")), 1_000)
      worker.onerror = (event) => {
        clearTimeout(timer)
        reject(event.error)
      }
      worker.onmessage = (event: MessageEvent) => {
        if ((event.data as { kind?: string }).kind === "ready") {
          clearTimeout(timer)
          resolve()
        }
      }
    })

    worker.postMessage({ kind: "init", dbPath: ":memory:" })
    await ready

    worker.postMessage({
      kind: "event",
      approxBytes: 100,
      envelope: {
        id: "01N",
        schemaVersion: 1,
        type: "llm_request_started",
        sessionId: "s1",
        rootSessionId: "s1",
        seq: 0,
        ts: 100,
        agentVersion: "v0",
        requestId: "r1",
        userMessageId: "u1",
        agent: "claude",
        modeId: "build",
        model: { providerId: "kilo", modelId: "free-1", isFree: true },
        input: { system: ["hi"], messages: [], tools: {}, permissions: [], params: {} },
        time: { created: 0 },
      },
    })

    const done = new Promise<{ count: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker count timeout")), 1_000)
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data as { kind?: string; count?: number }
        if (msg.kind === "test_event_count") {
          clearTimeout(timer)
          resolve({ count: msg.count ?? 0 })
        }
      }
    })
    worker.postMessage({ kind: "test_event_count" })
    const result = await done
    expect(result.count).toBe(1)

    worker.postMessage({ kind: "shutdown", timeoutMs: 500 })
    worker.terminate()
  })
})
