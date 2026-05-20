/**
 * hook-stream.ts — Stream write interception (ora Stream Hook pattern)
 *
 * Intercepts writes to a writable stream so an active spinner/progress
 * can clear itself, let the write through, then re-render.
 * Node builtins only (stream write hooking).
 */

export interface HookOptions {
  /** Debounce window (ms) to batch rapid partial writes. Default: 200. */
  debounceMs?: number
}

export function hookStream(
  stream: { write: (data: string | Buffer) => boolean },
  onIntercept: (data: string) => void,
  opts: HookOptions = {},
) {
  const { debounceMs = 200 } = opts
  const original = stream.write.bind(stream) as typeof stream.write
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending = ""

  const flush = () => {
    timer = undefined
    if (pending) {
      onIntercept(pending)
      pending = ""
    }
  }

  const hooked = (data: string | Buffer) => {
    const str = typeof data === "string" ? data : data.toString("utf-8")
    pending += str
    if (timer !== undefined) clearTimeout(timer)
    if (debounceMs > 0) {
      timer = setTimeout(flush, debounceMs)
    } else {
      flush()
    }
    return true
  }

  stream.write = hooked as typeof stream.write

  return {
    /** Restore the original stream.write. */
    restore() {
      if (timer !== undefined) clearTimeout(timer)
      stream.write = original
    },
    /** Flush any pending intercepted data immediately. */
    flush() {
      if (timer !== undefined) clearTimeout(timer)
      flush()
    },
    /** Get the original write function. */
    original,
  }
}
