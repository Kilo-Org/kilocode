import type { CodeIndexManager } from "@kilocode/kilo-indexing/engine"
import { format } from "node:util"
import type { Request, Result, Event, Log } from "./indexing-worker-protocol"
import { parseQdrantWarning } from "./indexing-warning"

let manager: CodeIndexManager | undefined
let progress: { dispose(): void } | undefined
let telemetry: { dispose(): void } | undefined

function send(message: Result | Event) {
  postMessage(message)
}

function write(level: Log["level"], args: unknown[]) {
  const message = format(...args)
  send({ type: "event", event: "log", data: { level, message } })
  if (level !== "warn") return
  const warning = parseQdrantWarning(message)
  if (warning) send({ type: "event", event: "warning", data: warning })
}

console.debug = (...args) => write("debug", args)
console.info = (...args) => write("info", args)
console.log = (...args) => write("info", args)
console.warn = (...args) => write("warn", args)
console.error = (...args) => write("error", args)

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
  const [engine, status] = await Promise.all([
    import("@kilocode/kilo-indexing/engine"),
    import("@kilocode/kilo-indexing/status"),
  ])
  const next = new engine.CodeIndexManager(request.input.directory, request.input.root)
  manager = next
  progress = next.onProgressUpdate.on(() => {
    send({ type: "event", event: "status", data: status.normalizeIndexingStatus(next) })
  })
  telemetry = next.onTelemetry.on((data) => {
    send({ type: "event", event: "telemetry", data })
  })
  await next.initialize(request.input.config)
  send({ type: "result", id: request.id, method: "init", ok: true, value: status.normalizeIndexingStatus(next) })
}

async function handle(request: Request) {
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

let queue = Promise.resolve()
onmessage = (event: MessageEvent<Request>) => {
  queue = queue.then(() => handle(event.data))
}
