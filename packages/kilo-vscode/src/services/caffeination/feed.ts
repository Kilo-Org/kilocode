// A session is running from `session.status` busy/retry or `session.execution.started` until
// `session.idle` or a terminal execution event. A session with a pending wakeup counts too: the machine must stay
// awake until the scheduled wake fires.
type Event = {
  type: string
  location?: { directory?: string }
  data?: unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function sessionID(event: Event): string | undefined {
  const value = record(event.data)
  return typeof value?.sessionID === "string" ? value.sessionID : undefined
}

function statusType(event: Event): string | undefined {
  const status = record(record(event.data)?.status)
  return typeof status?.type === "string" ? status.type : undefined
}

type Snapshot = { running: ReadonlySet<string>; wake?: ReadonlySet<string> }
type State = { running: Set<string>; wake: Set<string>; request?: { events: Event[]; promise: Promise<void> } }

function key(dir: string): string {
  const path = dir.replace(/\\/g, "/").replace(/\/+$/u, "") || "/"
  return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path
}

function busy(type: string | undefined): boolean {
  return type === "busy" || type === "retry"
}

/** The wakeup plugin's per-session pending count, published on every schedule and fire. */
const WAKEUP_CHANGED = "rpc.kilocode.wakeup.changed"

function apply(state: State, event: Event): void {
  const id = sessionID(event)
  if (!id) return
  if (event.type === WAKEUP_CHANGED) {
    const pending = record(event.data)?.pending
    if (typeof pending !== "number") return
    if (pending > 0) state.wake.add(id)
    else state.wake.delete(id)
    return
  }
  if (event.type === "session.execution.started" || event.type === "session.retry.scheduled") {
    state.running.add(id)
    return
  }
  if (event.type === "session.status") {
    if (busy(statusType(event))) state.running.add(id)
    else state.running.delete(id)
    return
  }
  if (event.type === "session.deleted") {
    state.running.delete(id)
    state.wake.delete(id)
    return
  }
  // Every other session event (text deltas, tool updates, steps) must not clear a running session.
  if (
    event.type === "session.idle" ||
    event.type === "session.error" ||
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted"
  )
    state.running.delete(id)
}

export function feed(opts: {
  paths: () => string[]
  watching: () => boolean
  load: (dir: string) => Promise<Snapshot>
  post: (busy: boolean) => void
}) {
  const dirs = new Map<string, string>()
  const states = new Map<string, State>()
  const publish = () =>
    opts.post([...states.values()].some((state) => state.running.size > 0 || state.wake.size > 0))
  const clear = () => {
    states.clear()
    publish()
  }
  const get = (dir: string, force = false): State => {
    const id = key(dir)
    const prior = states.get(id)
    const state: State = prior ?? { running: new Set(), wake: new Set() }
    states.set(id, state)
    if (state.request || (prior && !force)) return state
    const request: NonNullable<State["request"]> = {
      events: [],
      promise: Promise.resolve()
        .then<Snapshot>(() => (opts.watching() ? opts.load(dir) : { running: new Set(), wake: new Set() }))
        .catch((error: unknown) => {
          console.warn(`Kilo Agent Manager: keep-awake status refresh failed for ${dir}:`, error)
          // A transient failure must not release the inhibitor while a wakeup may still be pending.
          return { running: new Set<string>(), wake: undefined }
        })
        .then((snapshot) => {
          if (states.get(id) !== state || state.request !== request) return
          state.running = new Set(snapshot.running)
          if (snapshot.wake) state.wake = new Set(snapshot.wake)
          for (const event of request.events) apply(state, event)
          publish()
        })
        .finally(() => {
          if (state.request === request) state.request = undefined
        }),
    }
    state.request = request
    return state
  }
  const sync = async () => {
    if (!opts.watching()) return
    for (const dir of opts.paths()) if (dir) dirs.set(key(dir), dir)
    const paths = [...dirs.values()]
    dirs.clear()
    for (const dir of paths) dirs.set(key(dir), dir)
    await Promise.all([...dirs.values()].map((dir) => get(dir, true).request?.promise))
  }
  return {
    sync,
    clear,
    event(event: Event): void {
      const dir = event.location?.directory
      if (dir) dirs.set(key(dir), dir)
      if (!opts.watching()) return
      for (const state of dir ? [get(dir)] : states.values()) {
        state.request?.events.push(event)
        apply(state, event)
      }
      publish()
    },
    dispose(): void {
      clear()
      dirs.clear()
    },
  }
}