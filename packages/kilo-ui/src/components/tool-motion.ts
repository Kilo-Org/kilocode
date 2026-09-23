import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { useReducedMotion } from "../hooks/use-reduced-motion"

export { useReducedMotion } from "../hooks/use-reduced-motion"

/**
 * Tool motion plays only for tool parts that the user sees happen.
 *
 * The session store calls `touch` for every streamed part update. A tool row
 * that mounts shortly after an update, and that this webview has not shown
 * before, is new: it enters with an animation. A row whose status changes
 * while it is mounted is live: completion details reveal themselves. Rows
 * from history, a session switch, or a virtualizer remount are neither, so
 * they render without motion.
 *
 * Stylesheets drive the choreography from the data attributes this returns
 * (see tool-motion.css). Only row height uses a script-driven animation.
 */

const CAP = 2000
// A row counts as new when it mounts within this time of its last update.
const WINDOW = 1000
// Rows that mount in the same frame (parallel tool calls) enter one after another.
const STAGGER = 5

const touched = new Map<string, number>()
const seen = new Set<string>()

function trim(set: { size: number; keys(): IterableIterator<string>; delete(key: string): boolean }) {
  if (set.size <= CAP) return
  const first = set.keys().next().value
  if (first !== undefined) set.delete(first)
}

/** Record that a part changed now. */
export function touch(id: string) {
  touched.delete(id)
  touched.set(id, performance.now())
  trim(touched)
}

function fresh(id: string) {
  const at = touched.get(id)
  if (at === undefined || performance.now() - at > WINDOW) return false
  if (seen.has(id)) return false
  seen.add(id)
  trim(seen)
  return true
}

let count = 0
let frame: number | undefined

function slot() {
  frame ??= requestAnimationFrame(() => {
    frame = undefined
    count = 0
  })
  return Math.min(count++, STAGGER)
}

export function useToolMotion(props: { id: string; status: () => string | undefined }) {
  const enter = fresh(props.id)
  const [stagger, setStagger] = createSignal(enter ? slot() : 0)
  const [entering, setEntering] = createSignal(enter)
  const [changed, setChanged] = createSignal(false)
  createEffect(on(props.status, () => setChanged(true), { defer: true }))
  return {
    entering,
    stagger,
    live: () => enter || changed(),
    // Call from the wrapper's animationend so later reveals do not inherit the stagger delay.
    entered: () => {
      setEntering(false)
      setStagger(0)
    },
  }
}

const EASE = "cubic-bezier(0.23, 1, 0.32, 1)"
const DURATION = 220
// Matches --tool-motion-step in tool-motion.css.
const STEP = 30
// Collapsible open and close keyframes already animate the height. Follow them instead.
const TOGGLES = new Set(["tool-card-down", "tool-card-up"])

/**
 * Animate height changes of a live tool row so the transcript glides instead
 * of jumping when a body, output, or result appears. `body` is measured and
 * `el` is animated. User toggles and width changes resize without animation.
 */
export function useToolSize(props: {
  el: () => HTMLElement | undefined
  body: () => HTMLElement | undefined
  active: () => boolean
  motion: ReturnType<typeof useToolMotion>
}) {
  const reduce = useReducedMotion()
  let grow = props.motion.entering()

  createEffect(() => {
    if (!props.active()) return
    const node = props.el()
    const body = props.body()
    if (!node || !body) return

    let anim: Animation | undefined
    let size: number | undefined
    let width: number | undefined
    let quiet = 0

    const stop = () => {
      const current = anim
      anim = undefined
      current?.cancel()
      node.style.overflowY = ""
    }
    const hush = () => {
      quiet = performance.now() + 500
      stop()
    }
    const toggling = () =>
      body
        .getAnimations({ subtree: true })
        .some((item) => item instanceof CSSAnimation && TOGGLES.has(item.animationName))
    const run = (from: number, to: number, delay: number) => {
      const current = anim
      // Clip only vertically: tool rows bleed 6px to the sides for hover backgrounds.
      node.style.overflowY = "clip"
      const next = node.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: DURATION,
        easing: EASE,
        delay,
        fill: "backwards",
      })
      current?.cancel()
      anim = next
      next.onfinish = () => {
        if (anim !== next) return
        anim = undefined
        node.style.overflowY = ""
      }
    }

    const observer = new ResizeObserver((entries) => {
      const box = entries.at(-1)?.borderBoxSize?.[0]
      const next = box?.blockSize ?? body.offsetHeight
      const inline = box?.inlineSize ?? body.offsetWidth
      const prev = size
      const resized = width !== undefined && Math.abs(inline - width) > 1
      size = next
      width = inline
      const first = prev === undefined
      const from = first ? (grow ? 0 : undefined) : anim ? node.getBoundingClientRect().height : prev
      grow = false
      if (from === undefined) return
      if (reduce() || resized || performance.now() < quiet || toggling()) return stop()
      if (Math.abs(next - from) < 1) return
      run(from, next, first ? props.motion.stagger() * STEP : 0)
    })

    node.addEventListener("pointerdown", hush)
    node.addEventListener("keydown", hush)
    observer.observe(body)

    onCleanup(() => {
      observer.disconnect()
      node.removeEventListener("pointerdown", hush)
      node.removeEventListener("keydown", hush)
      // Never leave a pending animation on a node that is going away.
      stop()
    })
  })
}
