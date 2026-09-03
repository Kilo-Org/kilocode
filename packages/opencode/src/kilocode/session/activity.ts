import { Context, Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { registerDisposer } from "@/effect/instance-registry"
import { EffectBridge } from "@/effect/bridge"
import { capture } from "@/kilocode/instance"
import { SessionID } from "@/session/schema"
import type { SessionStatusEvent } from "@opencode-ai/schema/session-status-event"

type Status = SessionStatusEvent.Info
type Kind = "run" | "job" | "observer" | "call" | "inner" | "provider" | "handoff" | "delivery"
type State = {
  directory: string
  closed: boolean
  rows: Map<SessionID, Row>
  raw?: Map<SessionID, Status>
  notify?: (row: Row) => void
  queue: Promise<void>
}
type Row = {
  state: State
  id: SessionID
  handles: Set<Handle>
  requests: Set<Request>
  value?: boolean
  managed: boolean
  revision: number
}
type Handle = {
  row: Row
  kind: Kind
  live: boolean
  waits: number
}
export type Request = {
  live: boolean
  closed: boolean
  streaming: boolean
  waits: number
  message: string
  owner: Handle
  driver: Handle
  calls: Map<string, Handle>
}

const states = new Map<string, State>()
export const Generation = Context.Reference<State | undefined>("kilo/activity/generation", {
  defaultValue: () => undefined,
})
export const Current = Context.Reference<Handle | undefined>("kilo/activity/current", { defaultValue: () => undefined })
export const Pending = Context.Reference<Request | undefined>("kilo/activity/request", {
  defaultValue: () => undefined,
})

registerDisposer(async (directory) => {
  const state = states.get(directory)
  if (!state) return
  state.closed = true
  states.delete(directory)
  for (const row of state.rows.values()) {
    for (const handle of row.handles) handle.live = false
    for (const request of row.requests) request.live = false
  }
  state.rows.clear()
  await state.queue
})

export const generation = Effect.gen(function* () {
  const current = yield* Generation
  const directory = yield* InstanceState.directory
  if (current?.directory === directory) return current
  const existing = states.get(directory)
  if (existing) return existing
  const value: State = { directory, closed: false, rows: new Map(), queue: Promise.resolve() }
  states.set(directory, value)
  return value
})

function row(state: State, id: SessionID) {
  const existing = state.rows.get(id)
  if (existing) return existing
  const value: Row = { state, id, handles: new Set(), requests: new Set(), managed: false, revision: 0 }
  state.rows.set(id, value)
  return value
}

function working(row: Row, status = row.state.raw?.get(row.id)) {
  if (row.state.closed) return false
  return (
    [...row.handles].some((handle) => handle.live && handle.waits === 0) ||
    (!row.managed && (status?.type === "busy" || status?.type === "retry"))
  )
}

function update(row: Row) {
  if (row.state.closed) return
  const running = [...row.handles].some((handle) => handle.kind === "run" && handle.live)
  const jobs = [...row.handles].some((handle) => handle.kind === "job" && handle.live)
  for (const handle of row.handles) {
    if (handle.kind === "handoff") handle.waits = running ? 1 : 0
    if (handle.kind === "delivery") handle.waits = jobs ? 1 : 0
  }
  const value = working(row)
  if (value === row.value) return
  row.value = value
  row.revision++
  row.state.notify?.(row)
}

function open(row: Row, kind: Kind): Handle {
  const handle: Handle = { row, kind, live: !row.state.closed, waits: 0 }
  if (handle.live) row.handles.add(handle)
  if (handle.live && kind === "run") row.managed = true
  update(row)
  return handle
}

function close(handle: Handle) {
  if (!handle.live) return
  handle.live = false
  handle.row.handles.delete(handle)
  update(handle.row)
  if (!handle.row.handles.size && !handle.row.state.raw?.has(handle.row.id)) {
    handle.row.state.rows.delete(handle.row.id)
  }
}

function pause(handle: Handle | undefined) {
  if (!handle?.live) return () => {}
  handle.waits++
  update(handle.row)
  let held = true
  return () => {
    if (!held || !handle.live) return
    held = false
    handle.waits--
    update(handle.row)
  }
}

export const bind = (raw: Map<SessionID, Status>, publish: (id: SessionID, status: Status) => Effect.Effect<void>) =>
  Effect.gen(function* () {
    const data = yield* generation
    const bridge = yield* EffectBridge.make()
    data.raw = raw
    data.notify = (entry) => {
      const revision = entry.revision
      data.queue = data.queue
        .then(() =>
          bridge.promise(
            Effect.suspend(() => {
              if (data.closed || entry.revision !== revision) return Effect.void
              const current = data.rows.get(entry.id)
              if (current && current !== entry) return Effect.void
              return publish(entry.id, { ...(raw.get(entry.id) ?? { type: "idle" }), working: working(entry) })
            }),
          ),
        )
        .catch((error: unknown) => console.warn("[Kilo] Activity publication failed:", error))
    }
  })

export const overlay = (id: SessionID, status: Status) =>
  Effect.gen(function* () {
    const entry = (yield* generation).rows.get(id)
    return entry ? { ...status, working: working(entry, status) } : status
  })

export const list = (raw: Map<SessionID, Status>) =>
  Effect.gen(function* () {
    const data = yield* generation
    const result = new Map(raw)
    for (const [id, entry] of data.rows) {
      const value = working(entry, result.get(id))
      if (!value && !result.has(id)) continue
      result.set(id, { ...(result.get(id) ?? { type: "idle" }), working: value })
    }
    return result
  })

export const idle = (id: SessionID) =>
  Effect.gen(function* () {
    const data = yield* generation
    const entry = data.rows.get(id)
    if (!entry) return
    if (![...entry.handles].some((handle) => handle.kind === "run")) entry.managed = false
    update(entry)
    if (!entry.handles.size) data.rows.delete(id)
  })

export const flush = Effect.flatMap(generation, (data) => Effect.promise(() => data.queue))

export const hold = (id: SessionID) =>
  Effect.map(generation, (data) => {
    const handle = open(row(data, id), "delivery")
    return () => close(handle)
  })

export function run<A, E, R>(
  id: SessionID,
  work: Effect.Effect<A, E, R>,
  kind: "run" | "job" | "observer" | "inner" = "run",
) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const parent = kind === "run" ? yield* Current : undefined
      const handle = open(row(yield* generation, id), kind)
      return { handle, resume: handle.live ? pause(parent) : () => {} }
    }),
    ({ handle }) =>
      work.pipe(Effect.provideService(Current, handle), Effect.provideService(Generation, handle.row.state)),
    ({ handle, resume }) =>
      Effect.sync(() => {
        resume()
        close(handle)
      }),
  )
}

export function inner<A, E, R>(work: Effect.Effect<A, E, R>) {
  return Effect.flatMap(Current, (current) => (current?.live ? run(current.row.id, work, "inner") : work))
}

export const observe = Effect.map(Current, (current) => {
  let release: (() => void) | undefined
  return (waiting: boolean) => {
    if (waiting) {
      release ??= pause(current)
      return
    }
    release?.()
    release = undefined
  }
})

export function wait<A, E, R>(
  work: Effect.Effect<A, E, R>,
  input?: { sessionID: SessionID; tool?: { messageID: string; callID: string } },
) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const current = yield* Current
      if (current && !current.live) return () => {}
      const entry = input ? (yield* generation).rows.get(input.sessionID) : current?.row
      const tool = input?.tool
      const call = tool
        ? [...(entry?.requests ?? [])]
            .findLast((request) => request.live && request.message === tool.messageID)
            ?.calls.get(tool.callID)
        : undefined
      const handle =
        current?.kind === "inner" && (!input || current.row.id === input.sessionID)
          ? current
          : (call ??
            (current?.live && (!input || current.row.id === input.sessionID)
              ? current
              : [...(entry?.handles ?? [])].find((handle) => handle.kind === "run")))
      const request = [...(entry?.requests ?? [])].find((request) => request.live && request.owner === handle)
      if (request) {
        request.waits++
        balance(request)
      }
      const resume = pause(handle)
      return () => {
        resume()
        if (!request?.live) return
        request.waits--
        balance(request)
      }
    }),
    () => work,
    (resume) => Effect.sync(resume),
  )
}

export function follow<A, E, R>(id: SessionID, work: Effect.Effect<A, E, R>, kind: "handoff" | "delivery" = "handoff") {
  return Effect.acquireUseRelease(
    Effect.map(generation, (data) => open(row(data, id), kind)),
    (handle) => wait(work).pipe(Effect.provideService(Generation, handle.row.state)),
    (handle) => Effect.sync(() => close(handle)),
  )
}

export function request<A, E, R>(message: string, work: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const owner = yield* Current
      if (!owner?.live) return undefined
      const driver = open(owner.row, "provider")
      const value: Request = {
        live: true,
        closed: false,
        streaming: false,
        waits: 0,
        message,
        owner,
        driver,
        calls: new Map(),
      }
      owner.row.requests.add(value)
      return { value, resume: pause(owner) }
    }),
    (held) => work.pipe(Effect.provideService(Pending, held?.value)),
    (held) =>
      Effect.sync(() => {
        if (!held) return
        const value = held.value
        value.live = false
        held.resume()
        value.owner.row.requests.delete(value)
        for (const call of value.calls.values()) close(call)
        close(value.driver)
      }),
  )
}

function balance(request: Request) {
  request.driver.waits = !request.streaming && (request.waits > 0 || (request.closed && request.calls.size > 0)) ? 1 : 0
  update(request.driver.row)
}

export function start(request: Request | undefined) {
  if (!request?.live) return
  request.streaming = true
  balance(request)
}

export function reserve(request: Request | undefined, id: string) {
  if (!request?.live || request.calls.has(id)) return
  request.calls.set(id, open(request.owner.row, "call"))
  balance(request)
}

export function finish(request: Request | undefined) {
  if (!request?.live) return
  request.closed = true
  request.streaming = false
  balance(request)
}

export function settle(request: Request | undefined, id: string) {
  if (!request?.live) return
  const call = request.calls.get(id)
  if (!call) return
  request.calls.delete(id)
  balance(request)
  close(call)
}

export function call<A, E, R>(
  input: { sessionID: SessionID; messageID: string; callID?: string; abort?: AbortSignal },
  work: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      if (input.abort?.aborted) return undefined
      const parent = yield* Current
      if (parent && !parent.live) return undefined
      if (!capture()) return undefined
      const entry = row(yield* generation, input.sessionID)
      const pending = [...entry.requests].findLast((request) => request.live && request.message === input.messageID)
      if (pending && input.callID) reserve(pending, input.callID)
      const borrowed = input.callID ? pending?.calls.get(input.callID) : undefined
      const handle = borrowed ?? open(entry, "call")
      return { handle, borrowed, resume: parent === handle || !handle.live ? () => {} : pause(parent) }
    }),
    (held) =>
      held
        ? work.pipe(
            Effect.provideService(Current, held.handle),
            Effect.provideService(Generation, held.handle.row.state),
          )
        : work,
    (held) =>
      Effect.sync(() => {
        if (!held) return
        held.resume()
        if (!held.borrowed) close(held.handle)
      }),
  )
}

export * as Activity from "./activity"
