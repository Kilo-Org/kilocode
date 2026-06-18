import { describe, expect, test } from "bun:test"
import { Capture } from "@/kilocode/session-export/capture"

describe("session export performance budget", () => {
  const worker = { postMessage: () => {}, terminate: () => {} } as unknown as Worker
  const enabled = process.env.KILO_SESSION_EXPORT_PERF === "1" && process.env.CI !== "true"

  test.skipIf(!enabled)("ineligible beforeRequest p99 stays under 0.1 ms", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 0, syncSeq: () => 0 })
    const input = {
      input: { model: { api: { npm: "@ai-sdk/openai" }, isFree: true }, org: { type: "personal" as const } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    }
    const samples: number[] = []
    for (let i = 0; i < 10_000; i++) {
      const start = performance.now()
      cap.beforeRequest(input)
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    expect(samples[Math.floor(samples.length * 0.99)]).toBeLessThan(0.1)
  })

  test.skipIf(!enabled)("eligible beforeRequest p99 stays under 1 ms for 256 KB inputs", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 0, syncSeq: () => 0 })
    const body = "x".repeat(256 * 1024)
    const samples: number[] = []
    for (let i = 0; i < 200; i++) {
      const start = performance.now()
      cap.beforeRequest({
        input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" as const } },
        requestMeta: meta(`s${i}`),
        assembled: { system: [body], messages: [], tools: {}, permissions: [], params: {} },
      })
      samples.push(performance.now() - start)
    }
    samples.sort((a, b) => a - b)
    expect(samples[Math.floor(samples.length * 0.99)]).toBeLessThan(1)
  })
})

function meta(sessionId: string) {
  return {
    sessionId,
    rootSessionId: sessionId,
    requestId: "r1",
    userMessageId: "u1",
    agent: "build",
    modeId: "build",
  }
}
