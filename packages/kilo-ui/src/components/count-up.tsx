import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { useReducedMotion } from "../hooks/use-reduced-motion"

export const COUNT_UP_MS = 600

/**
 * A whole number that counts to each new value instead of jumping, the way the line counts of a streaming edit
 * climb. A change while counting continues from the number shown. `from` counts up on mount, for a counter that
 * appears because its value left zero.
 */
export function CountUp(props: { value: number; from?: number; class?: string }) {
  const reduced = useReducedMotion()
  const target = () => (Number.isFinite(props.value) ? Math.round(props.value) : 0)
  const [shown, setShown] = createSignal(props.from ?? target())
  let frame = 0

  const count = (to: number) => {
    cancelAnimationFrame(frame)
    const from = shown()
    if (from === to || reduced() || document.hidden) {
      setShown(to)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / COUNT_UP_MS)
      setShown(Math.round(from + (to - from) * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }

  onMount(() => {
    if (props.from !== undefined) count(target())
  })
  createEffect(on(target, count, { defer: true }))
  onCleanup(() => cancelAnimationFrame(frame))

  return (
    <span data-component="count-up" class={props.class} style={{ "font-variant-numeric": "tabular-nums" }}>
      {shown()}
    </span>
  )
}

/**
 * False until `ready` first holds, then true. Counters rendered with the first values show them at once; a counter
 * that mounts later passes `from={0}` while this is true, so it counts up as it appears.
 */
export function createCountStart(ready: () => boolean) {
  const [started, setStarted] = createSignal(false)
  createEffect(() => {
    if (!started() && ready()) setStarted(true)
  })
  return () => (started() ? 0 : undefined)
}
