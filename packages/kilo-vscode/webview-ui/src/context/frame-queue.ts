import type { ExtensionMessage } from "../types/messages"

/**
 * Coalesces streaming work into one drain per animation frame.
 *
 * Stream messages (part deltas) arrive as separate tasks, so two deltas that
 * land in one frame could commit and paint twice. Queueing them and applying
 * the whole queue in one reactive batch per frame aligns store commits with
 * paint: one DOM pass, one measure, one scroll pin.
 *
 * Only items the `coalesce` predicate accepts are deferred. Anything else
 * flushes the queue first and is applied synchronously, so control messages
 * (session created, messages loaded, status) keep their exact ordering and
 * other listeners that react to them in the same task see a consistent store.
 *
 * Hidden webviews do not run animation frames, so a timer keeps the queue
 * draining while the panel is not visible.
 */
export function createFrameQueue<T>(apply: (items: T[]) => void, coalesce: (item: T) => boolean = () => true) {
  const queue: T[] = []
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const drain = () => {
    if (frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame)
    if (timer !== undefined) clearTimeout(timer)
    frame = undefined
    timer = undefined
    if (queue.length === 0) return
    apply(queue.splice(0))
  }

  const schedule = () => {
    if (frame !== undefined || timer !== undefined) return
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden"
    if (typeof requestAnimationFrame === "function" && !hidden) {
      frame = requestAnimationFrame(drain)
    }
    // Fallback for hidden panels and stalled frames.
    timer = setTimeout(drain, hidden ? 0 : 100)
  }

  return {
    push(item: T) {
      if (!coalesce(item)) {
        drain()
        apply([item])
        return
      }
      queue.push(item)
      schedule()
    },
    /** Apply everything queued now. Tests and teardown use this. */
    flush: drain,
    get size() {
      return queue.length
    },
  }
}

/** Streaming deltas that are safe to coalesce into one frame. */
export function streamMessage(message: ExtensionMessage) {
  return message.type === "partUpdated" || message.type === "partsUpdated" || message.type === "partRemoved"
}
