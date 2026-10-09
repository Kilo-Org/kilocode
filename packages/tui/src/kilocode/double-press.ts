import { createSignal, onCleanup } from "solid-js"

/**
 * Tracks a "press again to confirm" gesture. `press()` returns true on the
 * second press inside `window` ms; each press restarts the window so a stale
 * timer can never reset a newer count early.
 */
export function createDoublePress(window: number) {
  const [count, setCount] = createSignal(0)
  let timer: ReturnType<typeof setTimeout> | undefined

  const reset = () => {
    clearTimeout(timer)
    timer = undefined
    setCount(0)
  }

  onCleanup(() => clearTimeout(timer))

  return {
    count,
    reset,
    press() {
      clearTimeout(timer)
      if (count() >= 1) {
        reset()
        return true
      }
      setCount(1)
      timer = setTimeout(reset, window)
      return false
    },
  }
}
