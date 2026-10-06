import { Effect } from "effect"

declare global {
  const KILO_RECLAIM_WORKER_PATH: string
}

export namespace KiloReclaim {
  export const minimum = 16 * 1024 * 1024
  export const ratio = 0.2

  export type Result = { vacuumed: boolean; reclaimedBytes: number }
  export type Reply = { ok: true; result: Result } | { ok: false; error: string }

  export function worth(pages: number, free: number, size: number): boolean {
    return pages > 0 && size > 0 && free * size >= minimum && free / pages >= ratio
  }

  export const run = Effect.fn("KiloReclaim.run")((file: string) => {
    if (!file || file === ":memory:") return Effect.succeed({ vacuumed: false, reclaimedBytes: 0 })
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const target =
          typeof KILO_RECLAIM_WORKER_PATH !== "undefined"
            ? KILO_RECLAIM_WORKER_PATH
            : new URL("./reclaim-worker.ts", import.meta.url)
        const worker = new Worker(target, { ref: true, preload: [] })
        const result = Promise.withResolvers<Result>()
        const closed = Promise.withResolvers<void>()
        // Failure can arrive before the Effect starts awaiting the result.
        void result.promise.catch(() => undefined)
        worker.onmessage = (event: MessageEvent<Reply>) => {
          if (event.data.ok) {
            result.resolve(event.data.result)
            return
          }
          result.reject(new Error(event.data.error))
        }
        worker.onerror = (event) => result.reject(event.error ?? new Error(event.message))
        worker.addEventListener("close", () => {
          result.reject(new Error("Session reclamation worker exited without a result"))
          closed.resolve()
        })
        worker.postMessage(file)
        return { worker, result, closed }
      }),
      (state) => Effect.promise(() => state.result.promise),
      (state) =>
        Effect.promise(async () => {
          // terminate() alone does not wait for native SQLite work to stop.
          state.worker.terminate()
          await state.closed.promise
        }),
    )
  })
}
