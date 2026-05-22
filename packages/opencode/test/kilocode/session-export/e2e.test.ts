import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ExportEvent } from "@/kilocode/session-export/events"

describe("session export worker e2e", () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  test("persists ordered scrubbed events through a real worker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "session-export-e2e-"))
    dirs.push(dir)
    const db = join(dir, "session-export.db")
    const worker = new Worker(new URL("../../../src/kilocode/session-export/worker.ts", import.meta.url))

    await ready(worker, db)
    for (const env of events()) {
      worker.postMessage({ kind: "event", approxBytes: 1000, envelope: env })
    }
    await until(() => rows(db).length === 3)
    await shutdown(worker)
    worker.terminate()

    const out = rows(db)
    expect(out.map((row) => row.type)).toEqual(["llm_request_started", "workspace_baseline_completed", "llm_request_completed"])
    const data = JSON.parse(out[0].data_json) as { input: { messages: Array<{ content: string }> } }
    expect(data.input.messages[0].content).toContain("<<REDACTED:aws_access_key>>")
    expect(out[0].client_scrubbed).toBe(1)
  })
})

function ready(worker: Worker, db: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker ready timeout")), 1_000)
    worker.onerror = (event) => {
      clearTimeout(timer)
      reject(event.error)
    }
    worker.onmessage = (event: MessageEvent) => {
      if ((event.data as { kind?: string }).kind !== "ready") return
      clearTimeout(timer)
      resolve()
    }
    worker.postMessage({ kind: "init", dbPath: db, endpoint: "http://127.0.0.1:1/session-export" })
  })
}

function shutdown(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker shutdown timeout")), 2_000)
    worker.onmessage = (event: MessageEvent) => {
      if ((event.data as { kind?: string }).kind !== "shutdown_done") return
      clearTimeout(timer)
      resolve()
    }
    worker.postMessage({ kind: "shutdown", timeoutMs: 500 })
  })
}

async function until(check: () => boolean): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 1_000) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("timed out waiting for worker rows")
}

function rows(path: string) {
  const db = new Database(path, { readonly: true })
  try {
    return db.query("SELECT type, seq, data_json, client_scrubbed FROM event ORDER BY seq ASC").all() as Array<{
      type: string
      seq: number
      data_json: string
      client_scrubbed: number
    }>
  } finally {
    db.close()
  }
}

function events(): ExportEvent[] {
  const base = {
    schemaVersion: 1 as const,
    sessionId: "s1",
    rootSessionId: "s1",
    ts: 100,
    agentVersion: "v0",
  }
  return [
    {
      ...base,
      id: "01S",
      type: "llm_request_started",
      seq: 0,
      requestId: "r1",
      userMessageId: "u1",
      agent: "build",
      modeId: "build",
      model: { providerId: "kilo", modelId: "free-1", isFree: true },
      input: {
        system: [],
        messages: [{ role: "user", content: "token=AKIAIOSFODNN7EXAMPLE" }],
        tools: {},
        permissions: {},
        params: {},
      },
      time: { created: 100 },
    },
    {
      ...base,
      id: "01T",
      type: "workspace_baseline_completed",
      seq: 1,
      snapshotId: "snap1",
      consistency: "stable",
      files: [{ path: "src/index.ts", kind: "file", size: 10, hash: "h1" }],
    },
    {
      ...base,
      id: "01U",
      type: "llm_request_completed",
      seq: 2,
      requestId: "r1",
      output: { textParts: ["ok"], finishReason: "stop" },
      durationMs: 12,
      retryCount: 0,
      time: { completed: 112 },
    },
  ]
}
