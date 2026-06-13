import type {
  IndexingConfigInput,
  IndexingTelemetryEvent,
  VectorStoreSearchResult,
} from "@kilocode/kilo-indexing/engine"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import { withTimeout } from "@/util/timeout"
import type { Log, Message, Request, Result } from "./indexing-worker-protocol"
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
    init(input: IndexingConfigInput): Promise<IndexingStatus>
    search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]>
    dispose(): Promise<void>
  }

  export type Factory = (directory: string, root: string, hooks: Hooks) => Driver

  type Host = Driver & {
    use(hooks: Hooks): void
  }

  const pool = new Map<string, Host>()

  const worker = (directory: string, root: string, hooks: Hooks): Host => {
    const file =
      typeof KILO_INDEXING_WORKER_PATH !== "undefined"
        ? KILO_INDEXING_WORKER_PATH
        : new URL("./indexing-worker.ts", import.meta.url)
    const key = `${directory}\0${root}`
    const task = new Worker(file, { ref: false })
    const pending = new Map<number, { resolve(message: Result): void; reject(err: unknown): void }>()
    let id = 0
    let stopped = false
    let active = true
    let callbacks = hooks

    const reject = (err: unknown) => {
      for (const item of pending.values()) item.reject(err)
      pending.clear()
    }

    const fail = (err: unknown) => {
      if (stopped) return
      stopped = true
      active = false
      reject(err)
      if (pool.get(key) === host) pool.delete(key)
      callbacks.failure(err)
    }

    task.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data
      if (message.type === "event") {
        if (stopped || !active) return
        if (message.event === "status") callbacks.status(message.data)
        if (message.event === "telemetry") callbacks.telemetry(message.data)
        if (message.event === "warning") callbacks.warning(message.data)
        if (message.event === "log") callbacks.log(message.data)
        return
      }

      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.ok) {
        request.resolve(message)
        return
      }
      request.reject(new Error(message.error))
    }

    task.onerror = (event) => {
      fail(event.error ?? new Error(event.message))
    }

    task.addEventListener("close", () => {
      if (pool.get(key) === host) pool.delete(key)
      fail(new Error("Indexing worker exited."))
    })

    const call = <T>(request: Request, read: (message: Result) => T) => {
      if (stopped) return Promise.reject(new Error("Indexing worker is unavailable."))
      return new Promise<T>((resolve, reject) => {
        pending.set(request.id, {
          resolve(message) {
            try {
              resolve(read(message))
            } catch (err) {
              reject(err)
            }
          },
          reject,
        })
        task.postMessage(request)
      })
    }

    const host: Host = {
      use(next) {
        callbacks = next
        active = true
      },
      init(config) {
        active = true
        const request: Request = {
          type: "request",
          id: id++,
          method: "init",
          input: {
            directory,
            root,
            config,
            lancedbPath: process.env.KILO_LANCEDB_PATH,
          },
        }
        return call(request, (message) => {
          if (message.ok && message.method === "init") return message.value
          throw new Error("Unexpected indexing worker init response.")
        })
      },
      search(query, directoryPrefix) {
        const request: Request = { type: "request", id: id++, method: "search", input: { query, directoryPrefix } }
        return call(request, (message) => {
          if (message.ok && message.method === "search") return message.value
          throw new Error("Unexpected indexing worker search response.")
        })
      },
      async dispose() {
        if (stopped || !active) return
        active = false
        const request: Request = { type: "request", id: id++, method: "dispose", input: undefined }
        await withTimeout(
          call(request, (message) => {
            if (message.ok && message.method === "dispose") return message.value
            throw new Error("Unexpected indexing worker dispose response.")
          }),
          1000,
          "Indexing worker reset timed out",
        ).catch((err) => {
          stopped = true
          reject(err)
        })
      },
    }
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
