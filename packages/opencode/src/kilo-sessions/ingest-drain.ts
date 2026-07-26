// Once-per-process guard around the session ingest shutdown drain.
// Overlapping shutdown paths (worker RPC, KiloShutdown, serve signals) must not double-POST.
export namespace IngestDrain {
  export function create(run: () => Promise<void>) {
    let done: Promise<void> | undefined
    return () => {
      if (!done) done = run()
      return done
    }
  }
}
