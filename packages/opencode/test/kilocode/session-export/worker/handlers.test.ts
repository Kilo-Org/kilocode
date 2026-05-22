import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Storage } from "@/kilocode/session-export/worker/storage"
import { Chunker } from "@/kilocode/session-export/worker/chunks"
import { Scrubber } from "@/kilocode/session-export/worker/scrub"
import { handleEvent } from "@/kilocode/session-export/worker/handlers"
import type { LlmRequestCompleted, LlmRequestStarted, WorkspaceBaselineCompleted } from "@/kilocode/session-export/events"

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
    const data = JSON.parse(rows[0].dataJson) as { input: { system: string[] } }
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

  test("persists with clientScrubbed=0 when scrubber fails", async () => {
    const scrubber = new Scrubber()
    ;(scrubber as unknown as { walk: (node: unknown) => unknown }).walk = () => {
      throw new Error("boom")
    }
    await handleEvent(started("01K", { system: [] }), { storage, chunker, scrubber, inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 1_000_000 })
    expect(rows[0].clientScrubbed).toBe(0)
  })

  test("large text field is chunked, not inlined", async () => {
    const env = completed("01L", "x".repeat(100_000))
    await handleEvent(env, { storage, chunker, scrubber: new Scrubber(), inlineThresholdBytes: 64 * 1024 })
    const rows = storage.pendingEvents({ now: 1000, limitBytes: 5_000_000 })
    const data = JSON.parse(rows[0].dataJson) as { output: { textParts: Array<string | { chunkIds: string[]; size: number }> } }
    expect(typeof data.output.textParts[0]).toBe("object")
    expect((data.output.textParts[0] as { chunkIds: string[] }).chunkIds.length).toBeGreaterThan(0)
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
    const data = JSON.parse(rows[0].dataJson) as { inputChunkIds: string[]; outputChunkIds: string[]; toolOutput?: string }
    expect(data.inputChunkIds.length).toBeGreaterThan(0)
    expect(data.outputChunkIds.length).toBeGreaterThan(0)
    expect(data.toolOutput).toBeUndefined()
  })

  test("drops identity fields before writing data_json", async () => {
    const env = started("01I", {
      messages: [
        {
          role: "user",
          content: "hello",
          accountId: "acct_123",
          email: "user@example.com",
          organizationId: "org_123",
        },
      ],
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
    input: { system: [], messages: [], tools: {}, permissions: {}, params: {}, ...input },
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
