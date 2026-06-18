import { describe, test, expect, beforeEach } from "bun:test"
import { Capture } from "@/kilocode/session-export/capture"
import { resetEligibility } from "@/kilocode/session-export/eligibility"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, SessionID } from "@/session/schema"
import type { MessageV2 } from "@/session/message-v2"
import { jsonSchema, tool } from "ai"

describe("Capture", () => {
  const posted: unknown[] = []
  const worker = {
    postMessage: (msg: unknown) => posted.push(msg),
    terminate: () => {},
  } as unknown as Worker

  beforeEach(() => {
    resetEligibility()
    posted.length = 0
  })

  test("ineligible input returns immediately and posts nothing", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: { model: { api: { npm: "@ai-sdk/openai" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    expect(posted.length).toBe(0)
  })

  test("free org requests do not start session export", async () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "org", id: "org_1" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    cap.afterRequest({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "r1",
      output: { textParts: ["ok"] },
      durationMs: 1,
      retryCount: 0,
    })
    await cap.onSessionClose("s1")
    expect(posted.length).toBe(0)
  })

  test("title agent requests do not start session export", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: { ...meta("s1"), agent: "title" },
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    cap.afterRequest({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "r1",
      output: { textParts: ["Remote E2E"] },
      durationMs: 1,
      retryCount: 0,
    })
    expect(posted.length).toBe(0)
  })

  test("eligible input posts llm_request_started with full envelope", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: {
        model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true, providerID: "kilo", id: "free-1" },
        org: { type: "personal" },
      },
      requestMeta: meta("s1"),
      assembled: { system: ["sys"], messages: [], tools: {}, permissions: [], params: {} },
    })
    expect(posted.length).toBe(1)
    const msg = posted[0] as {
      kind: string
      envelope: { type: string; seq: number; agentVersion: string; model: { providerId: string; modelId: string } }
    }
    expect(msg.kind).toBe("event")
    expect(msg.envelope.type).toBe("llm_request_started")
    expect(msg.envelope.seq).toBe(7)
    expect(msg.envelope.agentVersion).toBe("v0")
    expect(msg.envelope.model.providerId).toBe("kilo")
    expect(msg.envelope.model.modelId).toBe("free-1")
  })

  test("dispatch projects non-cloneable tool functions out of envelopes", () => {
    const cloneWorker = {
      postMessage: (msg: unknown) => {
        structuredClone(msg)
        posted.push(msg)
      },
      terminate: () => {},
    } as unknown as Worker
    const cap = new Capture({ worker: cloneWorker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: {
        model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true, providerId: "kilo", modelId: "free-1" },
        org: { type: "personal" },
      },
      requestMeta: meta("s1"),
      assembled: {
        system: [],
        messages: [],
        tools: {
          shell: tool({
            description: "run",
            inputSchema: jsonSchema({ type: "object", properties: {} }),
            execute: () => "ok",
          }),
        },
        permissions: [],
        params: {},
      },
    })
    const msg = posted[0] as { envelope: { input: { tools: { shell: { execute?: unknown; description: string } } } } }
    expect(msg.envelope.input.tools.shell.description).toBe("run")
    expect(msg.envelope.input.tools.shell.execute).toBeUndefined()
  })

  test("first eligible request of a session starts with llm_request_started", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    const types = posted.map((item) => (item as { envelope?: { type?: string } }).envelope?.type)
    expect(types).toEqual(["llm_request_started"])
  })

  test("session in degraded set drops subsequent events except SessionDegraded", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.markDegraded("s1")
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    const types = posted.map((item) => (item as { envelope?: { type?: string } }).envelope?.type)
    expect(types).toContain("session_degraded")
    expect(types.filter((type) => type === "llm_request_started").length).toBe(0)
  })

  test("later ineligible requests revoke downstream session capture", async () => {
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "h0", files: [] }),
        diff: async () => ({ snapshotHash: "h1", diff: [{ path: "src/a.ts", status: "modified", patchChunkIds: [] }] }),
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "org", id: "org_1" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    posted.length = 0

    cap.afterRequest({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "r1",
      output: { textParts: ["nope"] },
      durationMs: 1,
      retryCount: 0,
    })
    cap.compaction({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "r1",
      input: { inputMessagesSnapshot: [], selectedContext: [], prompt: "" },
      output: { summary: "", assistantMessageId: "a1" },
      modelId: "m1",
      durationMs: 1,
    })
    await cap.onSessionClose("s1")

    expect(cap.hasEligibleSession("s1")).toBe(false)
    expect(posted.length).toBe(0)
  })

  test("onSessionClose spawns a delta fiber for sessions that had eligible requests", async () => {
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "h0", files: [] }),
        diff: async () => ({ snapshotHash: "h1", diff: [{ path: "src/a.ts", status: "modified", patchChunkIds: [] }] }),
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    posted.length = 0
    await cap.onSessionClose("s1")
    const types = posted.map((item) => (item as { envelope?: { type?: string } }).envelope?.type)
    expect(types).toContain("workspace_delta_captured")
  })

  test("onSessionClose is best effort when final delta persistence fails", async () => {
    const errors: unknown[] = []
    let calls = 0
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      onPostError: (err) => errors.push(err),
      snapshotProvider: {
        current: () => "h0",
        baseline: async () => ({ snapshotId: "h0", files: [] }),
        diff: async () => ({ snapshotHash: "h1", diff: [] }),
        remember: () => {
          calls++
          if (calls === 1) return
          throw new Error("state failed")
        },
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(cap.onSessionClose("s1")).resolves.toBeUndefined()
    expect(String(errors[0])).toContain("state failed")
  })

  test("empty workspace deltas advance snapshot without dispatching", async () => {
    const remembered: string[] = []
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "h0", files: [] }),
        diff: async () => ({ snapshotHash: "h1", diff: [] }),
        remember: (_sessionId, snapshotId) => remembered.push(snapshotId),
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    posted.length = 0
    cap.afterRequest({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "r1",
      output: { textParts: ["ok"] },
      durationMs: 1,
      retryCount: 0,
    })
    await until(() => remembered.includes("h1"))
    const types = posted.map((item) => (item as { envelope?: { type?: string } }).envelope?.type)
    expect(types).not.toContain("workspace_delta_captured")
  })

  test("afterRequest captures a turn-end workspace delta after baseline resolves", async () => {
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "h0", files: [] }),
        diff: async () => ({ snapshotHash: "h1", diff: [{ path: "src/a.ts", status: "modified", patchChunkIds: [] }] }),
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    posted.length = 0
    cap.afterRequest({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "r1",
      output: { textParts: ["ok"] },
      durationMs: 1,
      retryCount: 0,
    })
    await until(() =>
      posted.some((item) => (item as { envelope?: { type?: string } }).envelope?.type === "workspace_delta_captured"),
    )
    const types = posted.map((item) => (item as { envelope?: { type?: string; trigger?: string } }).envelope)
    expect(types.map((item) => item?.type)).toContain("workspace_delta_captured")
    expect(types.find((item) => item?.type === "workspace_delta_captured")?.trigger).toBe("turn_end")
  })

  test("turnId groups request completion and workspace delta", async () => {
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "h0", files: [] }),
        diff: async () => ({ snapshotHash: "h1", diff: [{ path: "src/a.ts", status: "modified", patchChunkIds: [] }] }),
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    posted.length = 0
    cap.afterRequest({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "r1",
      output: { textParts: ["ok"] },
      durationMs: 1,
      retryCount: 0,
    })
    await until(() =>
      posted.some((item) => (item as { envelope?: { type?: string } }).envelope?.type === "workspace_delta_captured"),
    )

    const events = posted.map((item) => (item as { envelope?: { type?: string; turnId?: string } }).envelope)
    expect(events.find((item) => item?.type === "llm_request_completed")?.turnId).toBe("u1")
    expect(events.find((item) => item?.type === "workspace_delta_captured")?.turnId).toBe("u1")
  })

  test("workspace deltas for one session run serially", async () => {
    const gate = Promise.withResolvers<void>()
    const state = { active: 0, max: 0, calls: 0 }
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      snapshotProvider: {
        baseline: async () => ({ snapshotId: "h0", files: [] }),
        diff: async () => {
          state.active += 1
          state.calls += 1
          state.max = Math.max(state.max, state.active)
          if (state.calls === 1) await gate.promise
          state.active -= 1
          return {
            snapshotHash: `h${state.calls}`,
            diff: [{ path: "src/a.ts", status: "modified", patchChunkIds: [] }],
          }
        },
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    cap.afterRequest({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "r1",
      output: { textParts: ["ok"] },
      durationMs: 1,
      retryCount: 0,
    })
    await until(() => state.calls === 1)
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: { ...meta("s1"), requestId: "r2", userMessageId: "u2" },
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.max).toBe(1)
    gate.resolve()
    await until(() => state.calls === 2)
  })

  test("first request in a continued process uses persisted snapshot for next-request delta", async () => {
    const cap = new Capture({
      worker,
      agentVersion: "v0",
      nowMs: () => 100,
      syncSeq: () => 7,
      snapshotProvider: {
        current: () => "h0",
        remember: () => {},
        baseline: async () => ({ snapshotId: "unused", files: [] }),
        diff: async () => ({ snapshotHash: "h1", diff: [{ path: "src/a.ts", status: "modified", patchChunkIds: [] }] }),
      },
    })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    await until(() =>
      posted.some((item) => (item as { envelope?: { type?: string } }).envelope?.type === "workspace_delta_captured"),
    )
    const types = posted.map((item) => (item as { envelope?: { type?: string; trigger?: string } }).envelope)
    expect(types.map((item) => item?.type)).not.toContain("workspace_baseline_started")
    expect(types.find((item) => item?.type === "workspace_delta_captured")?.trigger).toBe("next_request")
  })

  test("compaction dispatches a self-contained compaction_captured envelope", () => {
    const cap = new Capture({ worker, agentVersion: "v0", nowMs: () => 100, syncSeq: () => 7 })
    cap.beforeRequest({
      input: { model: { api: { npm: "@kilocode/kilo-gateway" }, isFree: true }, org: { type: "personal" } },
      requestMeta: meta("s1"),
      assembled: { system: [], messages: [], tools: {}, permissions: [], params: {} },
    })
    posted.length = 0
    cap.compaction({
      sessionId: "s1",
      rootSessionId: "s1",
      requestId: "rA",
      input: {
        inputMessagesSnapshot: [{ role: "user", content: "..." }],
        selectedContext: context("ses_1"),
        prompt: "Summarize the conversation so far.",
      },
      output: { summary: "Discussed X.", assistantMessageId: "aA" },
      modelId: "free-1",
      durationMs: 42,
      usage: { inputTokens: 100, outputTokens: 50 },
    })
    const env = (posted[0] as { envelope: { type: string; input: { prompt: string }; output: { summary: string } } })
      .envelope
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
      input: { inputMessagesSnapshot: [], selectedContext: [], prompt: "" },
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

function context(sessionId: string): MessageV2.WithParts[] {
  return [
    {
      info: {
        id: MessageID.ascending(),
        sessionID: SessionID.make(sessionId),
        role: "user",
        time: { created: 0 },
        agent: "build",
        model: { providerID: ProviderID.make("kilo"), modelID: ModelID.make("free-1") },
      },
      parts: [],
    },
  ]
}

async function until(check: () => boolean): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 500) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
