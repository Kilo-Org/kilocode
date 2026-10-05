/**
 * Re-fetches providers while an organization's Kilo catalog is unavailable.
 * The CLI recovers the catalog in the background but does not notify clients,
 * so without this the model picker would stay empty until a reload.
 */
export function createCatalogRetry(opts: {
  refresh: () => void
  schedule?: (run: () => void, ms: number) => () => void
  delays?: readonly number[]
}) {
  const schedule =
    opts.schedule ??
    ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    })
  // Matches the CLI's own catalog recovery backoff.
  const delays = opts.delays ?? [30_000, 60_000, 120_000, 240_000, 300_000]
  let step = 0
  let cancel: (() => void) | undefined
  let disposed = false

  const stop = () => {
    cancel?.()
    cancel = undefined
  }

  return {
    /** Arm one retry while the catalog stays unavailable; reset once it loads. */
    update(unavailable: boolean) {
      // A fetch that settles after dispose must not re-arm the loop.
      if (disposed) return
      if (!unavailable) {
        stop()
        step = 0
        return
      }
      if (cancel) return
      const delay = delays.at(Math.min(step, delays.length - 1)) ?? 300_000
      step++
      cancel = schedule(() => {
        cancel = undefined
        opts.refresh()
      }, delay)
    },
    dispose() {
      disposed = true
      stop()
    },
  }
}
