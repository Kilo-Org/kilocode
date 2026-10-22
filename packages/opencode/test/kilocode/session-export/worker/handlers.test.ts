import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Storage } from "@/kilocode/session-export/worker/storage"
import { Chunker } from "@/kilocode/session-export/worker/chunks"
import { Scrubber } from "@/kilocode/session-export/worker/scrub"
import { handleEvent } from "@/kilocode/session-export/worker/handlers"
import type {
  CompactionCaptured,
  LlmRequestCompleted,
  LlmRequestStarted,
  WorkspaceBaselineCompleted,
  WorkspaceDeltaCaptured,
} from "@/kilocode/session-export/events"

describe("handlers", () => {
  let dir: string
  let storage: Storage
  let chunker: Chunker

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-export-"))
    storage = new Storage(join(dir, "session-export.db"))
    storage.migrate()
    chunker = new Chunker(storage, { chunkBytes: 1024 })
  })

  afterEach(() => {
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test("persists llm_request_started inline when small", async () => {
    const env = started("01H", { system: ["sys"] })
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    expect(rows.length).toBe(1)
    expect(rows[0].type).toBe("llm_request_started")
    const data = JSON.parse(rows[0].dataJson) as { requestId: string; input: { system: string[] } }
    expect(rows[0].requestId).toBe("r1")
    expect(data.requestId).toBe("r1")
    expect(data.input.system).toEqual(["sys"])
  })

  test("scrubs sensitive content before writing", async () => {
    const env = started("01J", { system: ["AKIAIOSFODNN7EXAMPLE"] })
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as { input: { system: string[] } }
    expect(data.input.system[0]).toContain("<<REDACTED:")
    expect(rows[0].clientScrubbed).toBe(1)
  })

  test("drops event when scrubber fails", async () => {
    const scrubber = new Scrubber()
    ;(scrubber as unknown as { walk: (node: unknown) => unknown }).walk = () => {
      throw new Error("boom")
    }
    await handleEvent(started("01K", { system: [] }), { storage, chunker, scrubber, inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    expect(rows).toEqual([])
  })

  test("large text field is chunked, not inlined", async () => {
    const env = completed("01L", "x".repeat(100_000))
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 5_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      output: { textParts: Array<string | { chunkIds: string[]; size: number }> }
    }
    expect(typeof data.output.textParts[0]).toBe("object")
    expect((data.output.textParts[0] as { chunkIds: string[] }).chunkIds.length).toBeGreaterThan(0)
  })

  test("drops duplicate tool result bodies from llm completion parts", async () => {
    const env = completed("01P", "done")
    env.output.toolCalls = [
      {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "bash",
        input: { command: "echo ok" },
        output: { output: "ok", metadata: { exit: 0 } },
      } as unknown as NonNullable<LlmRequestCompleted["output"]["toolCalls"]>[number],
    ]
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      output: { toolCalls?: Array<{ input?: unknown; output?: unknown; toolCallId?: string; toolName?: string }> }
    }
    expect(data.output.toolCalls?.[0].toolCallId).toBe("call_1")
    expect(data.output.toolCalls?.[0].toolName).toBe("bash")
    expect(data.output.toolCalls?.[0].input).toEqual({ command: "echo ok" })
    expect(data.output.toolCalls?.[0].output).toBeUndefined()
  })

  test("drops event sequencing and timing metadata before writing", async () => {
    const env = completed("01Q", "ok")
    env.eventSeq = 7
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      eventSeq?: number
      durationMs?: number
      retryCount?: number
      time?: unknown
    }
    expect(data.eventSeq).toBeUndefined()
    expect(data.durationMs).toBeUndefined()
    expect(data.retryCount).toBeUndefined()
    expect(data.time).toBeUndefined()
  })

  test("strings over maxPayloadBytes are truncated with originalSize", async () => {
    const env = completed("01M", "y".repeat(150_000))
    await handleEvent(env, {
      storage,
      chunker,
      scrubber: new Scrubber(),
      inlineThresholdBytes: 64 * 1024,
      maxPayloadBytes: 100_000,
    })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 5_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      output: { textParts: Array<{ truncated: boolean; originalSize: number; chunkIds: string[] }> }
    }
    expect(data.output.textParts[0].truncated).toBe(true)
    expect(data.output.textParts[0].originalSize).toBe(150_000)
  })

  test("tool I/O fields are converted to chunk id arrays when present", async () => {
    await handleEvent(
      {
        id: "01T",
        schemaVersion: 1,
        type: "tool_executed",
        sessionId: "s1",
        rootSessionId: "s1",
        seq: 0,
        ts: 100,
        agentVersion: "v0",
        toolCallId: "c1",
        toolName: "read_file",
        source: "builtin",
        inputChunkIds: [],
        outputChunkIds: [],
        toolInput: { path: "a.ts" },
        toolOutput: "z".repeat(100_000),
        durationMs: 1,
        retryCount: 0,
      },
      { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 },
    )
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 5_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      inputChunkIds: string[]
      outputChunkIds: string[]
      toolOutput?: string
    }
    expect(data.inputChunkIds.length).toBeGreaterThan(0)
    expect(data.outputChunkIds.length).toBeGreaterThan(0)
    expect(data.toolOutput).toBeUndefined()
  })

  test("drops identity fields before writing data_json", async () => {
    const env = started("01I", {
      params: {
        accountId: "acct_123",
        email: "user@example.com",
        organizationId: "org_123",
      },
    })
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    expect(rows[0].dataJson).not.toContain("acct_123")
    expect(rows[0].dataJson).not.toContain("user@example.com")
    expect(rows[0].dataJson).not.toContain("org_123")
  })

  test("omits high-risk workspace baseline paths", async () => {
    const env: WorkspaceBaselineCompleted = {
      id: "01W",
      schemaVersion: 1,
      type: "workspace_baseline_completed",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: 100,
      agentVersion: "v0",
      consistency: "stable",
      files: [
        { path: ".env", kind: "file", size: 10, hash: "secret-hash" },
        { path: "src/index.ts", kind: "file", size: 20, hash: "public-hash" },
      ],
    }
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      files: Array<{ path: string; kind?: string; hash?: string; omitted?: { reason: string } }>
    }
    expect(data.files[0]).toEqual({ path: ".env", kind: "file", omitted: { reason: "high_risk_path" } })
    expect(data.files[1].hash).toBe("public-hash")
  })

  test("workspace baseline file content is stored as upload chunks", async () => {
    const env: WorkspaceBaselineCompleted = {
      id: "01X",
      schemaVersion: 1,
      type: "workspace_baseline_completed",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: 100,
      agentVersion: "v0",
      consistency: "stable",
      files: [{ path: "src/index.ts", kind: "file", size: 21, hash: "h1", content: "export const value = 1\n" }],
    }
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      files: Array<{ content?: string; chunkIds?: string[]; encoding?: string }>
    }
    expect(data.files[0].content).toBeUndefined()
    expect(data.files[0].encoding).toBe("utf8")
    expect(data.files[0].chunkIds?.length).toBe(1)
    expect(storage.chunksForEvents([rows[0].id]).length).toBe(1)
  })

  test("drops workspace baseline bookkeeping before writing", async () => {
    const env: WorkspaceBaselineCompleted = {
      id: "01B",
      schemaVersion: 1,
      type: "workspace_baseline_completed",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: 100,
      agentVersion: "v0",
      consistency: "stable",
      snapshotId: "snap-1",
      capture: {
        mode: "git-tracked-and-untracked",
        fileCount: 1,
        totalBytes: 21,
        omittedCountsByReason: {},
        truncated: false,
      },
      truncated: false,
      originalFileCount: 1,
      originalTotalSize: 21,
      files: [{ path: "src/index.ts", kind: "file", size: 21, hash: "h1", content: "export const value = 1\n" }],
    }
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      snapshotId?: string
      capture?: unknown
      truncated?: boolean
      originalFileCount?: number
      originalTotalSize?: number
      files: unknown[]
    }
    expect(data.snapshotId).toBeUndefined()
    expect(data.capture).toBeUndefined()
    expect(data.truncated).toBeUndefined()
    expect(data.originalFileCount).toBeUndefined()
    expect(data.originalTotalSize).toBeUndefined()
    expect(data.files.length).toBe(1)
  })

  test("workspace delta patches are stored as upload chunks", async () => {
    const env: WorkspaceDeltaCaptured = {
      id: "01Y",
      schemaVersion: 1,
      type: "workspace_delta_captured",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: 100,
      agentVersion: "v0",
      snapshotHash: "h2",
      prevSnapshotHash: "h1",
      trigger: "turn_end",
      diff: [
        {
          path: "src/index.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patchChunkIds: [],
          patch: "@@ -1 +1 @@\n-export const value = 1\n+export const value = 2\n",
        },
      ],
    }
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as { diff: Array<{ patch?: string; patchChunkIds: string[] }> }
    expect(data.diff[0].patch).toBeUndefined()
    expect(data.diff[0].patchChunkIds.length).toBe(1)
    expect(storage.chunksForEvents([rows[0].id]).length).toBe(1)
  })

  test("drops workspace delta hashes before writing", async () => {
    const env: WorkspaceDeltaCaptured = {
      id: "01Z",
      schemaVersion: 1,
      type: "workspace_delta_captured",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: 100,
      agentVersion: "v0",
      snapshotHash: "h2",
      prevSnapshotHash: "h1",
      trigger: "turn_end",
      diff: [{ path: "src/index.ts", status: "removed", patchChunkIds: [] }],
    }
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as { snapshotHash?: string; prevSnapshotHash?: string; diff: unknown[] }
    expect(data.snapshotHash).toBeUndefined()
    expect(data.prevSnapshotHash).toBeUndefined()
    expect(data.diff.length).toBe(1)
  })

  test("normalizes compaction payload to input and output content", async () => {
    const env: CompactionCaptured = {
      id: "01C",
      schemaVersion: 1,
      type: "compaction_captured",
      sessionId: "s1",
      rootSessionId: "s1",
      seq: 0,
      ts: 100,
      agentVersion: "v0",
      input: {
        inputMessagesSnapshot: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        selectedContext: [
          {
            info: {
              id: "msg1",
              sessionID: "s1",
              role: "user",
              time: { created: 1 },
              cost: 1,
              path: { cwd: "/tmp/work", root: "/tmp/work" },
            },
            parts: [],
          } as unknown as CompactionCaptured["input"]["selectedContext"][number],
        ],
        previousSummary: "before",
        prompt: "summarize",
        tailStartId: "tail",
      },
      output: { summary: "after", assistantMessageId: "assistant" },
      modelId: "free",
      durationMs: 12,
      usage: { inputTokens: 1, outputTokens: 2 },
    }
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    const data = JSON.parse(rows[0].dataJson) as {
      input: {
        inputMessagesSnapshot?: unknown[]
        selectedContext?: unknown
        previousSummary?: string
        prompt?: string
        tailStartId?: string
      }
      output: { summary?: string; assistantMessageId?: string }
      modelId?: string
      usage?: unknown
    }
    expect(data.input.inputMessagesSnapshot?.length).toBe(1)
    expect(data.input.previousSummary).toBe("before")
    expect(data.input.prompt).toBe("summarize")
    expect(data.output.summary).toBe("after")
    expect(data.input.selectedContext).toBeUndefined()
    expect(data.input.tailStartId).toBeUndefined()
    expect(data.output.assistantMessageId).toBeUndefined()
    expect(data.modelId).toBeUndefined()
    expect(data.usage).toBeUndefined()
  })
})

function started(id: string, input: Partial<LlmRequestStarted["input"]>): LlmRequestStarted {
  return {
    id,
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
    input: { system: [], messages: [], tools: {}, permissions: [], params: {}, ...input },
    time: { created: 0 },
  }
}

function completed(id: string, text: string): LlmRequestCompleted {
  return {
    id,
    schemaVersion: 1,
    type: "llm_request_completed",
    sessionId: "s1",
    rootSessionId: "s1",
    seq: 0,
    ts: 100,
    agentVersion: "v0",
    requestId: "r1",
    output: { textParts: [text] },
    durationMs: 1,
    retryCount: 0,
    time: { completed: 0 },
  }
}
