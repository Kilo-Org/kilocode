import { describe, test, expect, beforeEach } from "bun:test"
import { Capture } from "@/kilocode/session-export/capture"

describe("Capture", () => {
  const posted: unknown[] = []
  const worker = {
    postMessage: (msg: unknown) => posted.push(msg),
    terminate: () => {},
  } as unknown as Worker

  beforeEach(() => {
    posted.length = 0
  })

  test("ineligible input returns immediately and posts nothing", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: { model: { api: { npm: "@ai-sdk/openai" }, isFree: true }, org: undefined },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: {}, params: {} },
    })
    expect(posted.length).toBe(0)
  })

  test("eligible input posts llm_request_started with full envelope", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: {
        model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true, providerId: "kilo", modelId: "free-1" },
        org: undefined,
      },
      requestMeta: meta("s1"),
      assembled: { system: ["sys"], messages: [], tools: {}, permissions: {}, params: {} },
    })
    expect(posted.length).toBe(2)
    const msg = posted[1] as { kind: string; envelope: { type: string; seq: number; agentVersion: string } }
    expect(msg.kind).toBe("event")
    expect(msg.envelope.type).toBe("llm_request_started")
    expect(msg.envelope.seq).toBe(7)
    expect(msg.envelope.agentVersion).toBe("v0")
  })

  test("first eligible request of a session emits workspace_baseline_started before llm_request_started", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: undefined },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: {}, params: {} },
    })
    const types = posted.map((item) => (item as { envelope?: { type?: string } }).envelope?.type)
    expect(types).toEqual(["workspace_baseline_started", "llm_request_started"])
  })

  test("session in degraded set drops subsequent events except SessionDegraded", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.markDegraded("s1")
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: undefined },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: {}, params: {} },
    })
    const types = posted.map((item) => (item as { envelope?: { type?: string } }).envelope?.type)
    expect(types).toContain("session_degraded")
    expect(types.filter((type) => type === "llm_request_started").length).toBe(0)
  })

  test("onSessionClose spawns a delta fiber for sessions that had eligible requests", async () => {
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "h0", files: [] }),
        diff: async () => ({ snapshotHash: "h1", diff: [] }),
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: undefined },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: {}, params: {} },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    posted.length = 0
    await cap.onSessionClose("s1")
    const types = posted.map((item) => (item as { envelope?: { type?: string } }).envelope?.type)
    expect(types).toContain("workspace_delta_captured")
  })

  test("compaction dispatches a self-contained compaction_captured envelope", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: undefined },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: {}, params: {} },
    })
    posted.length = 0
    cap.compaction({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "rA",
      input: {
        inputMessagesSnapshot: [{ role: "user", content: "..." }],
        selectedContext: { foo: 1 },
        prompt: "Summarize the conversation so far.",
      },
      output: { summary: "Discussed X.", assistantMessageId: "aA" },
      modelId: "free-1",
      durationMs: 42,
      usage: { inputTokens: 100, outputTokens: 50 },
    })
    const env = (posted[0] as { envelope: { type: string; input: { prompt: string }; output: { summary: string } } }).envelope
    expect(env.type).toBe("compaction_captured")
    expect(env.input.prompt).toContain("Summarize")
    expect(env.output.summary).toBe("Discussed X.")
  })

  test("compaction on a session without prior eligibility is dropped", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.compaction({
      sessionId: "s_unknown",
      rootSessionId: "s_unknown",
      requestId: "rZ",
      input: { inputMessagesSnapshot: [], selectedContext: {}, prompt: "" },
      output: { summary: "", assistantMessageId: "" },
      modelId: "free-1",
      durationMs: 0,
    })
    expect(posted.length).toBe(0)
  })
})

function meta(sessionId: string) {
  return {
    sessionId,
    rootSessionId: sessionId,
    requestId: "r1",
    userMessageId: "u1",
    agent: "claude",
    modeId: "build",
  }
}
