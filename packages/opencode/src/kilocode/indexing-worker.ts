import type { CodeIndexManager } from "@kilocode/kilo-indexing/engine"
import { AsyncLocalStorage } from "node:async_hooks"
import { format } from "node:util"
import type { Request, Result, Event, Log } from "./indexing-worker-protocol"
import { parseQdrantWarning } from "./indexing-warning"

type Entry = {
  manager: CodeIndexManager
  progress: { dispose(): void }
  telemetry: { dispose(): void }
}

const managers = new Map<string, Entry>()
const context = new AsyncLocalStorage<string>()
const queues = new Map<string, Promise<void>>()

function send(message: Result | Event) {
  postMessage(message)
}

function write(level: Log["level"], args: unknown[]) {
  const key = context.getStore()
  const message = format(...args)
  send({ type: "event", key, event: "log", data: { level, message } })
  if (level !== "warn") return
  const warning = parseQdrantWarning(message)
  if (warning) send({ type: "event", key, event: "warning", data: warning })
}

console.debug = (...args) => write("debug", args)
console.info = (...args) => write("info", args)
console.log = (...args) => write("info", args)
console.warn = (...args) => write("warn", args)
console.error = (...args) => write("error", args)

async function dispose(key: string) {
  const entry = managers.get(key)
  if (!entry) return
  managers.delete(key)
  entry.progress.dispose()
  entry.telemetry.dispose()
  await entry.manager.dispose()
}

async function init(request: Extract<Request, { method: "init" }>) {
  await dispose(request.key)
  if (request.input.lancedbPath) process.env.KILO_LANCEDB_PATH = request.input.lancedbPath
  const [engine, status] = await Promise.all([
    import("@kilocode/kilo-indexing/engine"),
    import("@kilocode/kilo-indexing/status"),
  ])
  const manager = new engine.CodeIndexManager(
    request.input.directory,
    request.input.root,
    request.input.baselineDirectory,
  )
  const progress = manager.onProgressUpdate.on(() => {
    send({ type: "event", key: request.key, event: "status", data: status.normalizeIndexingStatus(manager) })
  })
  const telemetry = manager.onTelemetry.on((data) => {
    send({ type: "event", key: request.key, event: "telemetry", data })
  })
  managers.set(request.key, { manager, progress, telemetry })
  await manager.initialize(request.input.config)
  send({ type: "result", id: request.id, method: "init", ok: true, value: status.normalizeIndexingStatus(manager) })
}

function nodeToResult(node: any): any {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    filePath: node.filePath,
    startLine: node.startLine,
    endLine: node.endLine,
    signature: node.signature,
    language: node.language,
  }
}

async function handle(request: Request) {
  try {
    if (request.method === "dispose") {
      await dispose(request.key)
      send({ type: "result", id: request.id, method: "dispose", ok: true, value: undefined })
      return
    }

    if (request.method === "search") {
      const value = await managers
        .get(request.key)
        ?.manager.searchIndex(request.input.query, request.input.directoryPrefix)
      send({ type: "result", id: request.id, method: "search", ok: true, value: value ?? [] })
      return
    }

    // kilocode_change - graph query handlers
    if (request.method === "graph_search") {
      const graph = managers.get(request.key)?.manager.graphIntegration?.search
      if (!graph) {
        send({ type: "result", id: request.id, method: "graph_search", ok: true, value: [] })
        return
      }
      const results = graph.search(request.input.query, {
        kinds: request.input.kinds as any,
        limit: request.input.limit ?? 20,
      })
      const value = results.map((r: any) => ({
        node: nodeToResult(r.node),
        score: r.score,
        callers: r.callers?.map(nodeToResult) ?? [],
        callees: r.callees?.map(nodeToResult) ?? [],
        related: r.related?.map(nodeToResult) ?? [],
      }))
      send({ type: "result", id: request.id, method: "graph_search", ok: true, value })
      return
    }

    if (request.method === "graph_find_references") {
      const db = managers.get(request.key)?.manager.graphIntegration
      if (!db) {
        send({ type: "result", id: request.id, method: "graph_find_references", ok: true, value: { definitions: [], references: [] } })
        return
      }
      const { definitions, references } = db.search.findReferences(request.input.symbol, request.input.filePath)
      const value = {
        definitions: definitions.map(nodeToResult),
        references: references.map(nodeToResult),
      }
      send({ type: "result", id: request.id, method: "graph_find_references", ok: true, value })
      return
    }

    if (request.method === "graph_call_hierarchy") {
      const db = managers.get(request.key)?.manager.graphIntegration
      if (!db) {
        send({ type: "result", id: request.id, method: "graph_call_hierarchy", ok: true, value: { incoming: [], outgoing: [] } })
        return
      }
      const { callers, callees, transitiveCallers, transitiveCallees } = db.search.getCallHierarchy(request.input.symbol)
      const direction = request.input.direction
      const maxDepth = request.input.maxDepth
      const incoming: Array<{ node: any; depth: number }> = []
      const outgoing: Array<{ node: any; depth: number }> = []
      if (direction === "incoming" || direction === "both") {
        for (const n of callers) incoming.push({ node: nodeToResult(n), depth: 1 })
        for (const n of transitiveCallers) incoming.push({ node: nodeToResult(n), depth: 2 })
      }
      if (direction === "outgoing" || direction === "both") {
        for (const n of callees) outgoing.push({ node: nodeToResult(n), depth: 1 })
        for (const n of transitiveCallees) outgoing.push({ node: nodeToResult(n), depth: 2 })
      }
      send({ type: "result", id: request.id, method: "graph_call_hierarchy", ok: true, value: { incoming, outgoing } })
      return
    }

    if (request.method === "graph_dependencies") {
      const db = managers.get(request.key)?.manager.graphIntegration
      if (!db) {
        send({ type: "result", id: request.id, method: "graph_dependencies", ok: true, value: { circular: [], chain: [] } })
        return
      }
      const circular = db.db.findCircularDependencies()
      let chain: Array<{ filePath: string; imports: string[]; importedBy: string[]; depth: number }> = []
      if (request.input.filePath) {
        chain = db.db.getDependencyChain(request.input.filePath, request.input.maxDepth)
      }
      send({ type: "result", id: request.id, method: "graph_dependencies", ok: true, value: { circular, chain } })
      return
    }

    if (request.method === "graph_impact") {
      const db = managers.get(request.key)?.manager.graphIntegration
      if (!db) {
        send({ type: "result", id: request.id, method: "graph_impact", ok: true, value: [] })
        return
      }
      const results = db.db.getImpactAnalysis(request.input.symbol, request.input.maxDepth)
      const value = results.map((r: any) => ({
        depth: r.depth,
        node: nodeToResult(r.node),
        relation: r.relation,
        confidence: r.confidence,
      }))
      send({ type: "result", id: request.id, method: "graph_impact", ok: true, value })
      return
    }

    if (request.method === "graph_trace") {
      const db = managers.get(request.key)?.manager.graphIntegration
      if (!db) {
        send({ type: "result", id: request.id, method: "graph_trace", ok: true, value: { path: [], pathLength: 0 } })
        return
      }
      const path = db.db.getShortestPath(request.input.from, request.input.to)
      const value = {
        path: path?.map(nodeToResult) ?? [],
        pathLength: path?.length ?? 0,
      }
      send({ type: "result", id: request.id, method: "graph_trace", ok: true, value })
      return
    }

    if (request.method === "graph_context") {
      const db = managers.get(request.key)?.manager.graphIntegration
      if (!db) {
        send({ type: "result", id: request.id, method: "graph_context", ok: true, value: { definitions: [], callers: [], callees: [], subclasses: [], superclasses: [], imports: [], importedBy: [] } })
        return
      }
      const ctx = db.db.getSymbolContext(request.input.symbol)
      const value = {
        definitions: ctx.definitions.map(nodeToResult),
        callers: ctx.callers.map(nodeToResult),
        callees: ctx.callees.map(nodeToResult),
        subclasses: ctx.subclasses.map(nodeToResult),
        superclasses: ctx.superclasses.map(nodeToResult),
        imports: ctx.imports,
        importedBy: ctx.importedBy,
      }
      send({ type: "result", id: request.id, method: "graph_context", ok: true, value })
      return
    }

    if (request.method === "graph_query") {
      const db = managers.get(request.key)?.manager.graphIntegration
      if (!db) {
        send({ type: "result", id: request.id, method: "graph_query", ok: true, value: [] })
        return
      }
      const value = db.db.rawQuery(request.input.sql, request.input.params)
      send({ type: "result", id: request.id, method: "graph_query", ok: true, value })
      return
    }

    await init(request)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    send({ type: "result", id: request.id, method: request.method, ok: false, error })
  }
}

onmessage = (event: MessageEvent<Request>) => {
  const request = event.data
  const prior = queues.get(request.key) ?? Promise.resolve()
  const task = prior.then(() => context.run(request.key, () => handle(request)))
  const queued = task.finally(() => {
    if (queues.get(request.key) === queued) queues.delete(request.key)
  })
  queues.set(request.key, queued)
}
