// Bun drops worker messages that arrive before the worker installs its handler, so the
// parent must not send RPC calls until the worker announces it is listening.
export namespace WorkerReady {
  export const Event = "tui.worker.ready"
  export const Timeout = 30_000

  // Subscribe synchronously right after creating the RPC client so the signal cannot be missed.
  export function wait(client: { on(event: string, handler: () => void): () => void }, timeout = Timeout) {
    const ready = Promise.withResolvers<boolean>()
    const off = client.on(Event, () => ready.resolve(true))
    const timer = setTimeout(() => ready.resolve(false), timeout)
    return ready.promise.finally(() => {
      clearTimeout(timer)
      off()
    })
  }
}
