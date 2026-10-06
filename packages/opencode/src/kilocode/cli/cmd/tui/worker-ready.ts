export namespace WorkerReady {
  export const Event = "tui.worker.ready"
  export const Timeout = 30_000

  // Bun can drop messages during worker initialization, even after its native open event.
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
