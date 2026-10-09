import type { Disp, Exit, Proc } from "../../pty/pty"

// bun-pty emits data and exit from its read loop and drops events that fire before a listener
// is attached. A short-lived child can exit in the gap between spawn and the Pty service
// registering its listeners, so buffer early events and replay them once a listener attaches.
// Replay runs in a microtask so the caller finishes wiring the session before it observes them.
function attach<T>(
  early: Disp,
  buffer: T[],
  subscribe: (listener: (event: T) => void) => Disp,
  listener: (event: T) => void,
): Disp {
  early.dispose()
  const disp = subscribe(listener)
  const state = { live: true }
  queueMicrotask(() => {
    if (!state.live) return
    for (const event of buffer.splice(0)) listener(event)
  })
  return {
    dispose() {
      state.live = false
      disp.dispose()
    },
  }
}

export function latch(proc: Proc): Proc {
  const data: string[] = []
  const exit: Exit[] = []
  const early = {
    data: proc.onData((chunk) => data.push(chunk)),
    exit: proc.onExit((event) => exit.push(event)),
  }
  return {
    ...proc,
    onData: (listener) => attach(early.data, data, (fn) => proc.onData(fn), listener),
    onExit: (listener) => attach(early.exit, exit, (fn) => proc.onExit(fn), listener),
  }
}
