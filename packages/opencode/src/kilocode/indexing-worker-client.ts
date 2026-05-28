import type {
  IndexingConfigInput,
  IndexingTelemetryEvent,
  VectorStoreSearchResult,
} from "@kilocode/kilo-indexing/engine"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import { withTimeout } from "@/util/timeout"
import type { Message, Request, Result } from "./indexing-worker-protocol"

declare global {
  const KILO_INDEXING_WORKER_PATH: string
}

export namespace IndexingWorker {
  export type Hooks = {
    status(status: IndexingStatus): void
    telemetry(event: IndexingTelemetryEvent): void
    failure(err: unknown): void
  }

  export type Driver = {
    init(input: IndexingConfigInput): Promise<IndexingStatus>
    search(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]>
    dispose(): Promise<void>
  }

  export type Factory = (directory: string, root: string, hooks: Hooks) => Driver

  const worker = (directory: string, root: string, hooks: Hooks): Driver => {
    const file =
      typeof KILO_INDEXING_WORKER_PATH !== "undefined"
        ? KILO_INDEXING_WORKER_PATH
        : new URL("./indexing-worker.ts", import.meta.url)
    const task = new Worker(file)
    const pending = new Map<number, { resolve(message: Result): void; reject(err: unknown): void }>()
    let id = 0
    let stopped = false
    let stopping = false

    const reject = (err: unknown) => {
      for (const item of pending.values()) item.reject(err)
      pending.clear()
    }

    const fail = (err: unknown) => {
      if (stopped || stopping) return
      stopped = true
      reject(err)
      task.terminate()
      hooks.failure(err)
    }

    task.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data
      if (message.type === "event") {
        if (stopping || stopped) return
        if (message.event === "status") hooks.status(message.data)
        if (message.event === "telemetry") hooks.telemetry(message.data)
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

    const call = <T>(request: Request, read: (message: Result) => T, allowStopping = false) => {
      if (stopped || (stopping && !allowStopping)) return Promise.reject(new Error("Indexing worker is disposed."))
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

    return {
      init(config) {
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
        if (stopped || stopping) return
        stopping = true
        const request: Request = { type: "request", id: id++, method: "dispose", input: undefined }
        await withTimeout(
          call(
            request,
            (message) => {
              if (message.ok && message.method === "dispose") return message.value
              throw new Error("Unexpected indexing worker dispose response.")
            },
            true,
          ),
          1000,
          "Indexing worker shutdown timed out",
        ).catch(() => undefined)
        stopped = true
        reject(new Error("Indexing worker is disposed."))
        task.terminate()
      },
    }
  }

  let factory: Factory = worker

  export function create(directory: string, root: string, hooks: Hooks) {
    return factory(directory, root, hooks)
  }

  export function override(next?: Factory) {
    factory = next ?? worker
  }
}
