import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js"

/** Keep the displayed value until the latest candidate stays put for its grace period. */
export function createSettledValue<T>(current: Accessor<T>, delay: Accessor<number>, initial: T): Accessor<T> {
  const [settled, setSettled] = createSignal(initial)
  createEffect(() => {
    const next = current()
    const ms = delay()
    if (next === untrack(settled)) return
    const commit = () => setSettled(() => next)
    if (!ms) return void commit()
    const timer = setTimeout(commit, ms)
    onCleanup(() => clearTimeout(timer))
  })
  return settled
}
