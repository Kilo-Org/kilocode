import type {
  IndexingConfigInput,
  IndexingTelemetryEvent,
  VectorStoreSearchResult,
} from "@kilocode/kilo-indexing/engine"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import { withTimeout } from "@/util/timeout"
import type { Event, Log, Message, Request, Result, GraphSearchResult, GraphHierarchyResult, GraphDependencyResult, GraphNodeResult, GraphImpactResult, GraphTraceResult, GraphContextResult } from "./indexing-worker-protocol"
import type { IndexingWarning } from "./indexing-warning"

declare global {
  const KILO_INDEXING_WORKER_PATH: string
}

export namespace IndexingWorker {
  export type Hooks = {
    status(status: IndexingStatus): void
    telemetry(event: IndexingTelemetryEvent): void
    warning(warning: IndexingWarning): void
    log(event: Log): void
    failure(err: unknown): void
  }

  export type Driver = {
    init(input: IndexingConfigInput, baselineDirectory?: string): Promise<IndexingStatus>
    search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]>
    dispose(): Promise<void>
    // kilocode_change - graph query methods
    graphSearch(query: string, kinds?: string[], limit?: number): Promise<GraphSearchResult[]>
    graphFindReferences(symbol: string, filePath?: string): Promise<{ definitions: GraphNodeResult[]; references: GraphNodeResult[] }>
    graphCallHierarchy(symbol: string, direction: string, maxDepth: number): Promise<GraphHierarchyResult>
    graphDependencies(filePath?: string, maxDepth?: number): Promise<{ circular: string[][]; chain: GraphDependencyResult[] }>
    graphImpact(symbol: string, maxDepth: number): Promise<GraphImpactResult[]>
    graphTrace(from: string, to: string): Promise<GraphTraceResult>
    graphContext(symbol: string): Promise<GraphContextResult>
    graphQuery(sql: string, params?: (string | number)[]): Promise<unknown[]>
  }

  export type Factory = (directory: string, root: string, hooks: Hooks) => Driver

  type Host = Driver & {
    use(hooks: Hooks): void
    event(message: Event): void
    fail(err: unknown): void
  }

  type Outgoing =
    | Omit<Extract<Request, { method: "init" }>, "id">
    | Omit<Extract<Request, { method: "search" }>, "id">
    | Omit<Extract<Request, { method: "dispose" }>, "id">
    // kilocode_change - graph outgoing requests
    | Omit<Extract<Request, { method: "graph_search" }>, "id">
    | Omit<Extract<Request, { method: "graph_find_references" }>, "id">
    | Omit<Extract<Request, { method: "graph_call_hierarchy" }>, "id">
    | Omit<Extract<Request, { method: "graph_dependencies" }>, "id">
    | Omit<Extract<Request, { method: "graph_impact" }>, "id">
    | Omit<Extract<Request, { method: "graph_trace" }>, "id">
    | Omit<Extract<Request, { method: "graph_context" }>, "id">
    | Omit<Extract<Request, { method: "graph_query" }>, "id">

  type Channel = {
    task: Worker
    pending: Map<number, { resolve(message: Result): void; reject(err: unknown): void }>
    hosts: Map<string, Host>
    id: number
    stopped: boolean
  }

  const pool = new Map<string, Host>()
  let shared: Channel | undefined

  const channel = () => {
    if (shared && !shared.stopped) return shared

    const file =
      typeof KILO_INDEXING_WORKER_PATH !== "undefined"
        ? KILO_INDEXING_WORKER_PATH
        : new URL("./indexing-worker.ts", import.meta.url)
    const state: Channel = {
      task: new Worker(file, { ref: false }),
      pending: new Map(),
      hosts: new Map(),
      id: 0,
      stopped: false,
    }

    const fail = (err: unknown) => {
      if (state.stopped) return
      state.stopped = true
      for (const item of state.pending.values()) item.reject(err)
      state.pending.clear()
      for (const host of state.hosts.values()) host.fail(err)
      state.hosts.clear()
      pool.clear()
      if (shared === state) shared = undefined
    }

    state.task.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data
      if (message.type === "event") {
        if (message.key) {
          state.hosts.get(message.key)?.event(message)
          return
        }
        for (const host of state.hosts.values()) host.event(message)
        return
      }

      const request = state.pending.get(message.id)
      if (!request) return
      state.pending.delete(message.id)
      if (message.ok) {
        request.resolve(message)
        return
      }
      request.reject(new Error(message.error))
    }
    state.task.onerror = (event) => fail(event.error ?? new Error(event.message))
    state.task.addEventListener("close", () => fail(new Error("Indexing worker exited.")))
    shared = state
    return state
  }

  const call = <T>(state: Channel, request: Outgoing, read: (message: Result) => T) => {
    if (state.stopped) return Promise.reject(new Error("Indexing worker is unavailable."))
    const id = state.id++
    const message: Request = { ...request, id }
    return new Promise<T>((resolve, reject) => {
      state.pending.set(id, {
        resolve(result) {
          try {
            resolve(read(result))
          } catch (err) {
            reject(err)
          }
        },
        reject,
      })
      state.task.postMessage(message)
    })
  }

  const worker = (directory: string, root: string, hooks: Hooks): Host => {
    const key = `${directory}\0${root}`
    const state = channel()
    let active = true
    let callbacks = hooks

    const host: Host = {
      use(next) {
        callbacks = next
        active = true
        state.hosts.set(key, host)
      },
      event(message) {
        if (!active) return
        if (message.event === "status") callbacks.status(message.data)
        if (message.event === "telemetry") callbacks.telemetry(message.data)
        if (message.event === "warning") callbacks.warning(message.data)
        if (message.event === "log") callbacks.log(message.data)
      },
      fail(err) {
        if (!active) return
        active = false
        callbacks.failure(err)
      },
      init(config, baselineDirectory) {
        active = true
        state.hosts.set(key, host)
        return call(
          state,
          {
            type: "request",
            key,
            method: "init",
            input: {
              directory,
              root,
              config,
              baselineDirectory,
              lancedbPath: process.env.KILO_LANCEDB_PATH,
            },
          },
          (message) => {
            if (message.ok && message.method === "init") return message.value
            throw new Error("Unexpected indexing worker init response.")
          },
        )
      },
      search(query, directoryPrefix) {
        return call(state, { type: "request", key, method: "search", input: { query, directoryPrefix } }, (message) => {
          if (message.ok && message.method === "search") return message.value
          throw new Error("Unexpected indexing worker search response.")
        })
      },
      // kilocode_change - graph query driver methods
      graphSearch(query, kinds, limit) {
        return call(state, { type: "request", key, method: "graph_search", input: { query, kinds, limit } }, (message) => {
          if (message.ok && message.method === "graph_search") return message.value
          throw new Error("Unexpected indexing worker graph_search response.")
        })
      },
      graphFindReferences(symbol, filePath) {
        return call(state, { type: "request", key, method: "graph_find_references", input: { symbol, filePath } }, (message) => {
          if (message.ok && message.method === "graph_find_references") return message.value
          throw new Error("Unexpected indexing worker graph_find_references response.")
        })
      },
      graphCallHierarchy(symbol, direction, maxDepth) {
        return call(state, { type: "request", key, method: "graph_call_hierarchy", input: { symbol, direction, maxDepth } }, (message) => {
          if (message.ok && message.method === "graph_call_hierarchy") return message.value
          throw new Error("Unexpected indexing worker graph_call_hierarchy response.")
        })
      },
      graphDependencies(filePath, maxDepth) {
        return call(state, { type: "request", key, method: "graph_dependencies", input: { filePath, maxDepth: maxDepth ?? 5 } }, (message) => {
          if (message.ok && message.method === "graph_dependencies") return message.value
          throw new Error("Unexpected indexing worker graph_dependencies response.")
        })
      },
      graphImpact(symbol, maxDepth) {
        return call(state, { type: "request", key, method: "graph_impact", input: { symbol, maxDepth } }, (message) => {
          if (message.ok && message.method === "graph_impact") return message.value
          throw new Error("Unexpected indexing worker graph_impact response.")
        })
      },
      graphTrace(from, to) {
        return call(state, { type: "request", key, method: "graph_trace", input: { from, to } }, (message) => {
          if (message.ok && message.method === "graph_trace") return message.value
          throw new Error("Unexpected indexing worker graph_trace response.")
        })
      },
      graphContext(symbol) {
        return call(state, { type: "request", key, method: "graph_context", input: { symbol } }, (message) => {
          if (message.ok && message.method === "graph_context") return message.value
          throw new Error("Unexpected indexing worker graph_context response.")
        })
      },
      graphQuery(sql, params) {
        return call(state, { type: "request", key, method: "graph_query", input: { sql, params } }, (message) => {
          if (message.ok && message.method === "graph_query") return message.value
          throw new Error("Unexpected indexing worker graph_query response.")
        })
      },
      async dispose() {
        if (!active || state.stopped) return
        active = false
        if (state.hosts.get(key) === host) state.hosts.delete(key)
        if (pool.get(key) === host) pool.delete(key)
        try {
          await withTimeout(
            call(state, { type: "request", key, method: "dispose", input: undefined }, (message) => {
              if (message.ok && message.method === "dispose") return message.value
              throw new Error("Unexpected indexing worker dispose response.")
            }),
            5000,
            "Indexing worker reset timed out",
          )
        } catch (err) {
          callbacks.failure(err)
        } finally {
          if (state.hosts.get(key) === host) state.hosts.delete(key)
          if (pool.get(key) === host) pool.delete(key)
        }
      },
    }
    state.hosts.set(key, host)
    return host
  }

  let factory: Factory | undefined

  export function create(directory: string, root: string, hooks: Hooks) {
    if (factory) return factory(directory, root, hooks)
    const key = `${directory}\0${root}`
    const existing = pool.get(key)
    if (existing) {
      existing.use(hooks)
      return existing
    }
    const next = worker(directory, root, hooks)
    pool.set(key, next)
    return next
  }

  export function override(next?: Factory) {
    factory = next
  }
}
