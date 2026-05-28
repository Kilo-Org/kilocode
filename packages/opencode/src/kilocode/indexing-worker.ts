import { CodeIndexManager } from "@kilocode/kilo-indexing/engine"
import { normalizeIndexingStatus } from "@kilocode/kilo-indexing/status"
import type { Request, Result, Event } from "./indexing-worker-protocol"

let manager: CodeIndexManager | undefined
let progress: { dispose(): void } | undefined
let telemetry: { dispose(): void } | undefined

function send(message: Result | Event) {
  postMessage(message)
}

function dispose() {
  progress?.dispose()
  telemetry?.dispose()
  progress = undefined
  telemetry = undefined
  manager?.dispose()
  manager = undefined
}

async function init(request: Extract<Request, { method: "init" }>) {
  dispose()
  if (request.input.lancedbPath) process.env.KILO_LANCEDB_PATH = request.input.lancedbPath
  const next = new CodeIndexManager(request.input.directory, request.input.root)
  manager = next
  progress = next.onProgressUpdate.on(() => {
    send({ type: "event", event: "status", data: normalizeIndexingStatus(next) })
  })
  telemetry = next.onTelemetry.on((data) => {
    send({ type: "event", event: "telemetry", data })
  })
  await next.initialize(request.input.config)
  send({ type: "result", id: request.id, method: "init", ok: true, value: normalizeIndexingStatus(next) })
}

onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    if (request.method === "dispose") {
      dispose()
      send({ type: "result", id: request.id, method: "dispose", ok: true, value: undefined })
      return
    }

    if (request.method === "search") {
      const value = manager ? await manager.searchIndex(request.input.query, request.input.directoryPrefix) : []
      send({ type: "result", id: request.id, method: "search", ok: true, value })
      return
    }

    await init(request)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    send({ type: "result", id: request.id, method: request.method, ok: false, error })
  }
}
