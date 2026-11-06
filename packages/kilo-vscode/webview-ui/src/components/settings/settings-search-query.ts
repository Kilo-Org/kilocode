import { createSignal } from "solid-js"

type Schedule = (run: () => void) => number
type Cancel = (handle: number) => void

const schedule: Schedule = (run) => requestAnimationFrame(run)
const cancel: Cancel = (handle) => cancelAnimationFrame(handle)

/**
 * The typed query and the settled query that search reads. Input is deferred to
 * the next frame, so several key events in one frame share one scan. Actions
 * that read results must flush first, or they would use the previous set.
 */
export function createDeferredQuery(onSchedule: Schedule = schedule, onCancel: Cancel = cancel) {
  const [query, setQuery] = createSignal("")
  const [settled, setSettled] = createSignal("")
  let handle: number | undefined

  const stop = () => {
    if (handle !== undefined) onCancel(handle)
    handle = undefined
  }

  return {
    query,
    settled,
    pending: () => query() !== settled(),
    input(value: string) {
      setQuery(value)
      stop()
      if (value.trim().length === 0) {
        setSettled(value)
        return
      }
      handle = onSchedule(() => {
        handle = undefined
        setSettled(value)
      })
    },
    /** Apply the pending query now, so a key that acts on results never reads the old set. */
    flush() {
      stop()
      setSettled(query())
    },
    clear() {
      stop()
      setQuery("")
      setSettled("")
    },
    dispose: stop,
  }
}
