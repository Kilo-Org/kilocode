// A session is running from `session.status` busy/retry or `session.execution.started` until
// `session.idle` or a terminal execution event.
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

type State = { running: Set<string>; request?: { events: Event[]; promise: Promise<void> } }

function key(dir: string): string {
  const path = dir.replace(/\\/g, "/").replace(/\/+$/u, "") || "/"
  return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path
}

function busy(type: string | undefined): boolean {
  return type === "busy" || type === "retry"
}

function apply(state: State, event: Event): void {
  const id = sessionID(event)
  if (!id) return
  if (event.type === "session.execution.started" || event.type === "session.retry.scheduled") {
    state.running.add(id)
    return
  }
  if (event.type === "session.status" && busy(statusType(event))) {
    state.running.add(id)
    return
  }
  state.running.delete(id)
}

export function feed(opts: {
  paths: () => string[]
  watching: () => boolean
  load: (dir: string) => Promise<ReadonlySet<string>>
  post: (busy: boolean) => void
}) {
  const dirs = new Map<string, string>()
  const states = new Map<string, State>()
  const publish = () => opts.post([...states.values()].some((state) => state.running.size > 0))
  const clear = () => {
    states.clear()
    publish()
  }
  const get = (dir: string, force = false): State => {
    const id = key(dir)
    const prior = states.get(id)
    const state: State = prior ?? { running: new Set() }
    states.set(id, state)
    if (state.request || (prior && !force)) return state
    const request: NonNullable<State["request"]> = {
      events: [],
      promise: Promise.resolve()
        .then<ReadonlySet<string>>(() => (opts.watching() ? opts.load(dir) : new Set()))
        .catch((error: unknown) => {
          console.warn(`Kilo Agent Manager: keep-awake status refresh failed for ${dir}:`, error)
          return new Set<string>()
        })
        .then((running) => {
          if (states.get(id) !== state || state.request !== request) return
          state.running = new Set(running)
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