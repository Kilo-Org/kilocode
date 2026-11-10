import { samePath } from "./project/paths"
import type { AgentManagerConnection } from "./connection"

type Snapshot = {
  /** The sessions of the directory, so events without a location can find it. */
  sessions?: string[]
  statuses: Record<string, { type: string }>
  permissions: Array<{ id: string; sessionID: string }>
  questions: Array<{ id: string; sessionID: string }>
}

type Change =
  | { kind: "session"; sessionID: string }
  | { kind: "status"; sessionID: string; type: string }
  | { kind: "permission.add"; id: string; sessionID: string }
  | { kind: "permission.remove"; id: string; sessionID: string }
  | { kind: "question.add"; id: string; sessionID: string }
  | { kind: "question.remove"; id: string; sessionID: string }
  | { kind: "clear"; sessionID: string }

type State = {
  dir: string
  loaded: boolean
  sessions: Set<string>
  statuses: Map<string, string>
  permissions: Map<string, string>
  questions: Map<string, string>
  request?: Request
}

type Request = {
  readonly state: State
  readonly events: Change[]
  readonly promise: Promise<void>
}

type Options = {
  paths: () => string[]
  load: (dir: string) => Promise<Snapshot>
  post: (active: string[]) => void
  log: (err: unknown) => void
}

type FactoryOptions = {
  connection: Pick<AgentManagerConnection, "client" | "state" | "onState" | "onEvent">
  paths: () => string[]
  post: (active: string[]) => void
  status: (sessionID: string, running: boolean) => void
  log: (err: unknown) => void
}

const TYPES = new Set([
  "session.created",
  "session.status",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.retry.scheduled",
  "session.idle",
  "session.deleted",
  "permission.asked",
  "permission.replied",
  "form.created",
  "form.replied",
  "form.cancelled",
  "global.disposed",
])

function normalize(dir: string): string {
  const value = dir.replace(/\\/g, "/")
  if (/^[A-Za-z]:\/+$/u.test(value)) return `${value.slice(0, 2)}/`
  const result = value.replace(/\/+$/u, "")
  return result || "/"
}

function matches(a: string, b: string): boolean {
  return samePath(normalize(a), normalize(b))
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export class WorktreeActivity {
  private states: State[] = []
  private cache: string[] = []
  private dead = false

  constructor(private readonly opts: Options) {}

  static accepts(event: unknown): boolean {
    const value = record(event)
    return value !== undefined && typeof value.type === "string" && TYPES.has(value.type)
  }

  async sync(force = false): Promise<void> {
    if (this.dead) return

    let changed = false
    const wanted: State[] = []
    const current = this.states
    for (const dir of this.opts.paths()) {
      const state = this.find(current, wanted, dir)
      if (!state) continue
      if (wanted.includes(state)) continue
      if (state.dir !== dir) changed = true
      state.dir = dir
      wanted.push(state)
    }

    changed = this.prune(current, wanted) || changed
    if (wanted.length !== current.length) changed = true
    this.states = wanted

    const jobs: Promise<void>[] = []
    changed = this.load(wanted, force, jobs) || changed
    await Promise.all(jobs)
    if (changed) this.publish()
  }

  replay(): void {
    if (this.dead) return
    this.opts.post(this.cache.slice())
  }

  event(event: unknown, directory?: string): void {
    if (this.dead || !WorktreeActivity.accepts(event)) return
    const value = record(event)
    if (!value) return

    const type = value.type
    if (type === "global.disposed") {
      const dir = string(value.location && record(value.location)?.directory) ?? directory
      if (!dir) return
      const state = this.states.find((item) => matches(item.dir, dir))
      if (!state) return
      this.invalidate(state)
      state.loaded = false
      this.publish()
      return
    }
    const change = this.change(type, value.data)
    if (!change) return
    // The server sends session events without a location: find the directory from the session it names.
    const dir =
      directory ?? (type === "session.created" ? string(record(record(value.data)?.location)?.directory) : undefined)
    const state = dir
      ? this.states.find((item) => matches(item.dir, dir))
      : this.states.find((item) => item.sessions.has(change.sessionID) || item.statuses.has(change.sessionID))
    if (!state) return
    if (state.request) state.request.events.push(change)
    this.apply(state, change)
    this.publish()
  }

  pause(): void {
    if (this.dead) return
    for (const state of this.states) {
      state.request = undefined
      state.loaded = false
    }
  }

  clear(): void {
    if (this.dead) return
    for (const state of this.states) this.invalidate(state)
    this.states = []
    this.cache = []
    this.opts.post([])
  }

  dispose(): void {
    if (this.dead) return
    this.dead = true
    for (const state of this.states) this.invalidate(state)
    this.states = []
    this.cache = []
  }

  private state(dir: string): State {
    return {
      dir,
      loaded: false,
      sessions: new Set(),
      statuses: new Map(),
      permissions: new Map(),
      questions: new Map(),
    }
  }

  private find(current: State[], wanted: State[], dir: unknown): State | undefined {
    if (typeof dir !== "string" || !dir) return undefined
    return (
      current.find((item) => matches(item.dir, dir)) ?? wanted.find((item) => matches(item.dir, dir)) ?? this.state(dir)
    )
  }

  private prune(current: State[], wanted: State[]): boolean {
    let changed = false
    for (const state of current) {
      if (wanted.includes(state)) continue
      this.invalidate(state)
      changed = true
    }
    return changed
  }

  private load(wanted: State[], force: boolean, jobs: Promise<void>[]): boolean {
    let changed = false
    for (const state of wanted) {
      const req = state.request ?? (!state.loaded || force ? this.request(state) : undefined)
      if (req) jobs.push(req.promise)
      if (req || !state.loaded || force) changed = true
    }
    return changed
  }

  private request(state: State): Request {
    const req: Request = {
      state,
      events: [],
      promise: Promise.resolve()
        .then(() => this.opts.load(state.dir))
        .then((snapshot) => this.finish(req, snapshot))
        .catch((err: unknown) => {
          if (this.valid(req)) req.state.loaded = false
          this.opts.log(err)
        })
        .finally(() => {
          if (state.request === req) state.request = undefined
        }),
    }
    state.request = req
    return req
  }

  private finish(req: Request, snapshot: Snapshot): void {
    if (!this.valid(req)) return
    const next = this.state(req.state.dir)
    for (const sessionID of snapshot.sessions ?? []) next.sessions.add(sessionID)
    for (const [sessionID, status] of Object.entries(snapshot.statuses ?? {})) {
      if (typeof status?.type === "string") next.statuses.set(sessionID, status.type)
    }
    for (const item of snapshot.permissions ?? []) {
      if (typeof item?.id === "string" && typeof item.sessionID === "string")
        next.permissions.set(item.id, item.sessionID)
    }
    for (const item of snapshot.questions ?? []) {
      if (typeof item?.id === "string" && typeof item.sessionID === "string")
        next.questions.set(item.id, item.sessionID)
    }
    for (const change of req.events) this.apply(next, change)
    Object.assign(req.state, {
      sessions: next.sessions,
      statuses: next.statuses,
      permissions: next.permissions,
      questions: next.questions,
      loaded: true,
    })
    this.publish()
  }

  private valid(req: Request): boolean {
    return !this.dead && req.state.request === req && this.states.includes(req.state)
  }

  private invalidate(state: State): void {
    state.request = undefined
    state.loaded = false
    state.sessions.clear()
    state.statuses.clear()
    state.permissions.clear()
    state.questions.clear()
  }

  private change(type: unknown, props: unknown): Change | undefined {
    const value = record(props)
    if (!value) return undefined
    if (type === "session.created") {
      const sessionID = string(value.sessionID)
      return sessionID ? { kind: "session", sessionID } : undefined
    }
    if (type === "session.status") return this.status(value)
    if (type === "session.execution.started" || type === "session.retry.scheduled") return this.running(value, type)
    if (
      type === "session.execution.succeeded" ||
      type === "session.execution.failed" ||
      type === "session.execution.interrupted" ||
      type === "session.idle"
    )
      return type === "session.execution.failed" ? this.cleared(value) : this.idle(value)
    if (type === "session.deleted") return this.cleared(value)
    if (type === "permission.asked" || type === "form.created") return this.add(type, value)
    if (type === "permission.replied" || type === "form.replied" || type === "form.cancelled")
      return this.remove(type, value)
    return undefined
  }

  private status(value: Record<string, unknown>): Change | undefined {
    const sessionID = string(value.sessionID)
    const status = record(value.status)
    const type = string(status?.type)
    return sessionID && type ? { kind: "status", sessionID, type } : undefined
  }

  private running(value: Record<string, unknown>, type: "session.execution.started" | "session.retry.scheduled"): Change | undefined {
    const sessionID = string(value.sessionID)
    if (!sessionID) return undefined
    return { kind: "status", sessionID, type: type === "session.retry.scheduled" ? "retry" : "busy" }
  }

  private idle(value: Record<string, unknown>): Change | undefined {
    const sessionID = string(value.sessionID)
    return sessionID ? { kind: "status", sessionID, type: "idle" } : undefined
  }

  private cleared(value: Record<string, unknown>): Change | undefined {
    const sessionID = string(value.sessionID) ?? string(record(value.info)?.id)
    return sessionID ? { kind: "clear", sessionID } : undefined
  }

  private add(type: unknown, value: Record<string, unknown>): Change | undefined {
    if (type === "form.created") {
      const form = record(value.form)
      const id = string(form?.id)
      const sessionID = string(form?.sessionID)
      return id && sessionID ? { kind: "question.add", id, sessionID } : undefined
    }
    const id = string(value.id)
    const sessionID = string(value.sessionID)
    if (!id || !sessionID) return undefined
    return type === "permission.asked"
      ? { kind: "permission.add", id, sessionID }
      : { kind: "question.add", id, sessionID }
  }

  private remove(type: unknown, value: Record<string, unknown>): Change | undefined {
    const id = string(value.requestID) ?? string(value.id)
    const sessionID = string(value.sessionID)
    if (!id || !sessionID) return undefined
    return type === "permission.replied"
      ? { kind: "permission.remove", id, sessionID }
      : { kind: "question.remove", id, sessionID }
  }

  private apply(state: State, change: Change): void {
    if (change.kind !== "clear") state.sessions.add(change.sessionID)
    if (change.kind === "session") return
    if (change.kind === "status") {
      state.statuses.set(change.sessionID, change.type)
      return
    }
    if (change.kind === "permission.add") {
      state.permissions.set(change.id, change.sessionID)
      return
    }
    if (change.kind === "permission.remove") {
      if (state.permissions.get(change.id) === change.sessionID) state.permissions.delete(change.id)
      return
    }
    if (change.kind === "question.add") {
      state.questions.set(change.id, change.sessionID)
      return
    }
    if (change.kind === "question.remove") {
      if (state.questions.get(change.id) === change.sessionID) state.questions.delete(change.id)
      return
    }
    state.sessions.delete(change.sessionID)
    state.statuses.delete(change.sessionID)
    for (const [id, sessionID] of state.permissions) {
      if (sessionID === change.sessionID) state.permissions.delete(id)
    }
    for (const [id, sessionID] of state.questions) {
      if (sessionID === change.sessionID) state.questions.delete(id)
    }
  }

  private active(state: State): boolean {
    const blocked = new Set([...state.permissions.values(), ...state.questions.values()])
    for (const [sessionID, type] of state.statuses) {
      if ((type === "busy" || type === "retry") && !blocked.has(sessionID)) return true
    }
    return false
  }

  private publish(): void {
    if (this.dead) return
    const active = this.states.filter((state) => this.active(state)).map((state) => state.dir)
    this.cache = active.slice()
    this.opts.post(active)
  }
}

export function createWorktreeActivity(opts: FactoryOptions) {
  const activity = new WorktreeActivity({
    paths: opts.paths,
    load: async (dir) => {
      const client = await opts.connection.client()
      const [sessions, active, permission, form] = await Promise.all([
        client.session.list({ directory: dir, parentID: null }),
        client.session.active(),
        client.permission.request.list({ location: { directory: dir } }),
        client.form.list({ location: { directory: dir } }),
      ])
      const ids = new Set(sessions.data.map((session) => session.id))
      const statuses = Object.fromEntries(
        Object.keys(active)
          .filter((id) => ids.has(id))
          .map((id) => [id, { type: "busy" }]),
      )
      return {
        sessions: [...ids],
        statuses,
        permissions: permission.data.map((item) => ({ id: item.id, sessionID: item.sessionID })),
        questions: form.data.map((item) => ({ id: item.id, sessionID: item.sessionID })),
      }
    },
    post: opts.post,
    log: opts.log,
  })
  const unsubEvent = opts.connection.onEvent((event) => {
    activity.event(event, event.location?.directory)
    if (event.type === "session.status" || event.type === "session.execution.started")
      opts.status(String(event.data.sessionID), true)
    if (
      event.type === "session.idle" ||
      event.type === "session.execution.succeeded" ||
      event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted"
    )
      opts.status(String(event.data.sessionID), false)
  })
  const sync = (force = false) => {
    if (force) activity.replay()
    // Without a connection the load would fail for every directory and leave stale badges.
    if (opts.connection.state() !== "connected") return Promise.resolve()
    return activity.sync(force)
  }
  const unsubState = opts.connection.onState((state) => {
    if (state === "connecting") return activity.pause()
    if (state !== "connected") return activity.clear()
    // A restart may have lost or changed the busy and blocked sessions, so reload every directory.
    void sync(true)
  })
  return {
    sync,
    pause: () => activity.pause(),
    clear: () => activity.clear(),
    dispose: () => {
      unsubEvent()
      unsubState()
      activity.dispose()
    },
  }
}