import { realpathSync } from "node:fs"
import type { SessionStatus } from "@kilocode/sdk/v2/client"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"

type Snapshot = {
  status: Record<string, Pick<SessionStatus, "type">>
  wake: Record<string, number> | undefined
}
type Update = Extract<
  SSEPayload,
  { type: "session.status" | "session.idle" | "session.deleted" | "session.error" | "session.wakeup" }
>
type State = { values: Set<string>; wake: Set<string>; request?: { events: Update[]; promise: Promise<void> } }

function key(dir: string): string {
  const path = dir.replace(/\\/g, "/").replace(/\/+$/u, "") || "/"
  return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path
}

function busy(status: Pick<SessionStatus, "type">): boolean {
  return status.type === "busy" || status.type === "retry"
}

function apply(state: State, event: Update): void {
  const id = event.properties.sessionID ?? (event.type === "session.deleted" ? event.properties.info?.id : undefined)
  if (!id) return
  if (event.type === "session.wakeup") {
    if (event.properties.pending > 0) state.wake.add(id)
    else state.wake.delete(id)
    return
  }
  if (event.type === "session.status" && busy(event.properties.status)) {
    state.values.add(id)
    return
  }
  state.values.delete(id)
  if (event.type === "session.deleted") state.wake.delete(id)
}

export function feed(opts: {
  paths: () => string[]
  watching: () => boolean
  load: (dir: string) => Promise<Snapshot>
  post: (busy: boolean) => void
}) {
  const dirs = new Map<string, string>()
  const states = new Map<string, State>()
  const aliases = new Map<string, string>()
  const resolve = (dir: string): string => {
    const path = key(dir)
    const prior = aliases.get(path)
    if (prior || !opts.watching()) return prior ?? path
    try {
      const id = key(realpathSync.native(dir))
      aliases.set(path, id)
      aliases.set(id, id)
      return id
    } catch {
      aliases.set(path, path)
      return path
    }
  }
  const publish = () => opts.post([...states.values()].some((state) => state.values.size > 0 || state.wake.size > 0))
  const clear = () => {
    states.clear()
    aliases.clear()
    publish()
  }
  const get = (dir: string, force = false): State => {
    const id = resolve(dir)
    const prior = states.get(id)
    const state: State = prior ?? { values: new Set(), wake: new Set() }
    states.set(id, state)
    if (state.request || (prior && !force)) return state
    const request: NonNullable<State["request"]> = {
      events: [],
      promise: Promise.resolve()
        .then<Snapshot>(() => (opts.watching() ? opts.load(dir) : { status: {}, wake: {} }))
        .catch((error: unknown) => {
          console.warn(`[Kilo New] Keep-awake status refresh failed for ${dir}:`, error)
          // Keep the last known wake set: a transient failure must not release
          // the inhibitor while wakeups may still be pending.
          return { status: {}, wake: undefined }
        })
        .then((snapshot) => {
          if (states.get(id) !== state || state.request !== request) return
          state.values = new Set(
            Object.entries(snapshot.status)
              .filter(([, status]) => busy(status))
              .map(([id]) => id),
          )
          if (snapshot.wake)
            state.wake = new Set(
              Object.entries(snapshot.wake)
                .filter(([, pending]) => pending > 0)
                .map(([id]) => id),
            )
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
    for (const dir of paths) dirs.set(resolve(dir), dir)
    await Promise.all([...dirs.values()].map((dir) => get(dir, true).request?.promise))
  }
  return {
    sync,
    clear,
    event(event: SSEPayload, directory?: string): void {
      if (event.type === "server.instance.disposed") {
        const id = resolve(event.properties.directory)
        for (const [alias, target] of aliases) if (target === id) aliases.delete(alias)
        dirs.delete(id)
        states.delete(id)
        publish()
        return
      }
      if (
        event.type !== "session.status" &&
        event.type !== "session.idle" &&
        event.type !== "session.deleted" &&
        event.type !== "session.error" &&
        event.type !== "session.wakeup"
      )
        return
      if (directory) dirs.set(resolve(directory), directory)
      if (!opts.watching()) return
      if (!directory && event.type === "session.status" && busy(event.properties.status)) {
        clear()
        void sync()
        return
      }
      for (const state of directory ? [get(directory)] : states.values()) {
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
