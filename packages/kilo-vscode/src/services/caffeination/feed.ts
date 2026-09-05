import { realpathSync } from "node:fs"
import type { SessionStatus } from "@kilocode/sdk/v2/client"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"

type Snapshot = Record<string, Pick<SessionStatus, "type">>
type Update = Extract<SSEPayload, { type: "session.status" | "session.idle" | "session.deleted" | "session.error" }>
type State = { values: Set<string>; request?: { events: Update[]; promise: Promise<void> } }

function key(dir: string): string {
  const path = dir.replace(/\\/g, "/").replace(/\/+$/u, "") || "/"
  return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path
}

function busy(status: Pick<SessionStatus, "type">): boolean {
  return status.type === "busy" || status.type === "retry"
}

function apply(values: Set<string>, event: Update): void {
  const id = event.properties.sessionID ?? (event.type === "session.deleted" ? event.properties.info?.id : undefined)
  if (!id) return
  if (event.type === "session.status" && busy(event.properties.status)) {
    values.add(id)
    return
  }
  values.delete(id)
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
  const publish = () => opts.post([...states.values()].some((state) => state.values.size > 0))
  const clear = () => {
    states.clear()
    aliases.clear()
    publish()
  }
  const get = (dir: string, force = false): State => {
    const id = resolve(dir)
    const prior = states.get(id)
    const state: State = prior ?? { values: new Set() }
    states.set(id, state)
    if (state.request || (prior && !force)) return state
    const request: NonNullable<State["request"]> = {
      events: [],
      promise: Promise.resolve()
        .then<Snapshot>(() => (opts.watching() ? opts.load(dir) : {}))
        .catch((error: unknown) => {
          console.warn(`[Kilo New] Keep-awake status refresh failed for ${dir}:`, error)
          return {}
        })
        .then((snapshot) => {
          if (states.get(id) !== state || state.request !== request) return
          state.values = new Set(
            Object.entries(snapshot)
              .filter(([, status]) => busy(status))
              .map(([id]) => id),
          )
          for (const event of request.events) apply(state.values, event)
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
        event.type !== "session.error"
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
        apply(state.values, event)
      }
      publish()
    },
    dispose(): void {
      clear()
      dirs.clear()
    },
  }
}
