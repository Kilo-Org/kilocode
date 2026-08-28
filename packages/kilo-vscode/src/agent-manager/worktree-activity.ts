import { samePath } from "./project/paths"
import type { KiloConnectionService } from "../services/cli-backend"

type Snapshot = {
  statuses: Record<string, { type: string }>
  permissions: Array<{ id: string; sessionID: string }>
  questions: Array<{ id: string; sessionID: string; blocking?: boolean }>
}

type Change =
  | { kind: "status"; sessionID: string; type: string }
  | { kind: "permission.add"; id: string; sessionID: string }
  | { kind: "permission.remove"; id: string; sessionID: string }
  | { kind: "question.add"; id: string; sessionID: string }
  | { kind: "question.remove"; id: string; sessionID: string }
  | { kind: "clear"; sessionID: string }

type State = {
  dir: string
  loaded: boolean
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
  connection: KiloConnectionService
  paths: () => string[]
  post: (active: string[]) => void
  status: (event: unknown) => void
  lifecycle: (event: unknown) => void
  log: (err: unknown) => void
}

const TYPES = new Set([
  "session.status",
  "session.deleted",
  "session.error",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
  "server.instance.disposed",
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
    if (type === "server.instance.disposed") {
      const props = record(value.properties)
      const dir = string(props?.directory) ?? directory
      if (!dir) return
      const state = this.states.find((item) => matches(item.dir, dir))
      if (!state) return
      this.invalidate(state)
      state.loaded = false
      this.publish()
      return
    }
    if (!directory) return
    const state = this.states.find((item) => matches(item.dir, directory))
    if (!state) return

    const change = this.change(type, value.properties)
    if (!change) return
    if (state.request) state.request.events.push(change)
    this.apply(state, change)
    this.publish()
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
    for (const [sessionID, status] of Object.entries(snapshot.statuses ?? {})) {
      if (typeof status?.type === "string") next.statuses.set(sessionID, status.type)
    }
    for (const item of snapshot.permissions ?? []) {
      if (typeof item?.id === "string" && typeof item.sessionID === "string")
        next.permissions.set(item.id, item.sessionID)
    }
    for (const item of snapshot.questions ?? []) {
      if (item?.blocking !== false && typeof item?.id === "string" && typeof item.sessionID === "string")
        next.questions.set(item.id, item.sessionID)
    }
    for (const change of req.events) this.apply(next, change)
    Object.assign(req.state, {
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
    state.statuses.clear()
    state.permissions.clear()
    state.questions.clear()
  }

  private change(type: unknown, props: unknown): Change | undefined {
    const value = record(props)
    if (!value) return undefined
    if (type === "session.status") return this.status(value)
    if (type === "session.deleted" || type === "session.error") return this.cleared(value)
    if (type === "permission.asked" || type === "question.asked") return this.add(type, value)
    if (type === "permission.replied" || type === "question.replied" || type === "question.rejected")
      return this.remove(type, value)
    return undefined
  }

  private status(value: Record<string, unknown>): Change | undefined {
    const sessionID = string(value.sessionID)
    const status = record(value.status)
    const type = string(status?.type)
    return sessionID && type ? { kind: "status", sessionID, type } : undefined
  }

  private cleared(value: Record<string, unknown>): Change | undefined {
    const info = record(value.info)
    const sessionID = string(value.sessionID) ?? string(info?.id)
    return sessionID ? { kind: "clear", sessionID } : undefined
  }

  private add(type: unknown, value: Record<string, unknown>): Change | undefined {
    const id = string(value.id)
    const sessionID = string(value.sessionID)
    if (!id || !sessionID) return undefined
    if (type === "question.asked" && value.blocking === false) return { kind: "question.remove", id, sessionID }
    return type === "permission.asked"
      ? { kind: "permission.add", id, sessionID }
      : { kind: "question.add", id, sessionID }
  }

  private remove(type: unknown, value: Record<string, unknown>): Change | undefined {
    const id = string(value.requestID)
    const sessionID = string(value.sessionID)
    if (!id || !sessionID) return undefined
    return type === "permission.replied"
      ? { kind: "permission.remove", id, sessionID }
      : { kind: "question.remove", id, sessionID }
  }

  private apply(state: State, change: Change): void {
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
      const client = opts.connection.getClient()
      const [status, permission, question] = await Promise.all([
        client.session.status({ directory: dir }, { throwOnError: true }),
        client.permission.list({ directory: dir }, { throwOnError: true }),
        client.question.list({ directory: dir }, { throwOnError: true }),
      ])
      return {
        statuses: status.data ?? {},
        permissions: permission.data ?? [],
        questions: question.data ?? [],
      }
    },
    post: opts.post,
    log: opts.log,
  })
  const filter = (event: unknown) => {
    const type = record(event)?.type
    return WorktreeActivity.accepts(event) || type === "session.created" || type === "session.updated"
  }
  const unsubEvent = opts.connection.onEventFiltered(filter, (event, directory) => {
    activity.event(event, directory)
    const type = record(event)?.type
    if (type === "session.status") opts.status(event)
    if (
      type === "session.created" ||
      type === "session.updated" ||
      type === "session.deleted" ||
      type === "session.error"
    )
      opts.lifecycle(event)
  })
  const sync = (force = false) => {
    if (force) activity.replay()
    if (opts.connection.getConnectionState() !== "connected") return Promise.resolve()
    return activity.sync(force)
  }
  const unsubState = opts.connection.onStateChange((state) => {
    if (state !== "connected") return activity.clear()
    void sync(true)
  })
  return {
    sync,
    dispose: () => {
      unsubEvent()
      unsubState()
      activity.dispose()
    },
  }
}
