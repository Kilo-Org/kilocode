export type FocusTarget = "prompt" | "mainTerminal" | "sideTerminal" | "other"

const DELAY = 150

/** Remember whether a Kilo webview should reclaim prompt focus after OS window focus returns. */
export function createLatch(opts: { focused: () => boolean; defer?: (fn: () => void) => void }) {
  let held = false
  let live = false
  let locked = false
  let target: FocusTarget = "other"
  const defer = opts.defer ?? ((fn) => setTimeout(fn, 0))
  return {
    note(value: boolean) {
      live = value
      if (value) {
        held = true
        return
      }
      defer(() => {
        if (locked || !opts.focused()) return
        held = false
        target = "other"
      })
    },
    mark(value: FocusTarget) {
      if (locked) return
      target = value
    },
    lock() {
      locked = true
    },
    unlock() {
      locked = false
      held = live
    },
    restore() {
      return held && opts.focused() && target !== "mainTerminal" && target !== "sideTerminal"
    },
    live() {
      return live
    },
  }
}

export function watchRestore(opts: {
  focused: () => boolean
  onChange: (listener: (state: { focused: boolean }) => void) => { dispose(): void }
  restore: (state: { live: boolean; prompt: boolean }) => void
  enabled?: () => boolean
  defer?: (fn: () => void) => void
  wait?: (fn: () => void, ms: number) => { dispose(): void }
  delay?: number
}) {
  const view = createLatch({ focused: opts.focused, defer: opts.defer })
  const prompt = createLatch({ focused: opts.focused, defer: opts.defer })
  const wait =
    opts.wait ??
    ((fn, ms) => {
      const id = setTimeout(fn, ms)
      return { dispose: () => clearTimeout(id) }
    })
  const delay = opts.delay ?? DELAY
  let pending = false
  let timer: { dispose(): void } | undefined
  const clear = () => {
    timer?.dispose()
    timer = undefined
  }
  const unlock = () => {
    view.unlock()
    prompt.unlock()
  }
  const sub = opts.onChange((state) => {
    clear()
    pending = false
    if (!state.focused) {
      view.lock()
      prompt.lock()
      return
    }
    if ((opts.enabled && !opts.enabled()) || !view.restore()) {
      unlock()
      return
    }
    pending = true
    timer = wait(() => {
      timer = undefined
      if (!pending) return
      pending = false
      if (!opts.focused() || (opts.enabled && !opts.enabled()) || !view.restore()) {
        unlock()
        return
      }
      opts.restore({ live: view.live(), prompt: prompt.restore() })
      unlock()
    }, delay)
  })
  return {
    note: (value: boolean) => view.note(value),
    input: (value: boolean) => prompt.note(value),
    mark: (value: FocusTarget) => view.mark(value),
    dispose: () => {
      clear()
      sub.dispose()
    },
  }
}
