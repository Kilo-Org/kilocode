import { createComputed, on, onCleanup, type Accessor } from "solid-js"

export function createPreferenceLoader(opts: {
  ready: Accessor<boolean>
  connected: Accessor<boolean>
  request: () => void
}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let disposed = false

  function cancel() {
    clearTimeout(timer)
    timer = undefined
  }

  function schedule() {
    if (disposed || opts.ready() || !opts.connected()) return
    timer = setTimeout(() => {
      timer = undefined
      if (disposed || opts.ready() || !opts.connected()) return
      if (attempts === 4) {
        // Exhaustion is not hydration: a late saved preference must still apply.
        console.warn("[Kilo New] Model preferences did not load after 4 attempts; waiting for a later retry")
        return
      }
      attempts++
      opts.request()
      schedule()
    }, 3000)
  }

  function retry() {
    if (disposed || opts.ready()) return
    cancel()
    attempts = 1
    opts.request()
    schedule()
  }

  onCleanup(() => {
    disposed = true
    cancel()
  })

  createComputed(
    on([opts.ready, opts.connected], ([ready, connected], previous) => {
      cancel()
      // The host may already know the disk path before the backend connects.
      if (!ready && (connected || !previous)) retry()
    }),
  )

  return retry
}
