// Once-per-process guard around the session ingest shutdown drain.
// Overlapping shutdown paths (worker RPC, KiloShutdown, serve signals) must not double-POST.
// The guarded call never rejects: a drain failure must not block the remaining shutdown
// sequence (disposeAllInstances / server.stop). Failures are logged once via the optional
// onError callback; later callers share the same resolved promise (no retry).
export namespace IngestDrain {
  export function create(run: () => Promise<void>, onError?: (err: unknown) => void) {
    let done: Promise<void> | undefined
    return () => {
      if (!done) {
        done = run().catch((err) => {
          onError?.(err)
        })
      }
      return done
    }
  }
}
