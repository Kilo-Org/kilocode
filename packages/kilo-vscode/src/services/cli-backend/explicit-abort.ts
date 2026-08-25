import path from "node:path"
import type { SSEPayload } from "./sdk-sse-adapter"

type Buffered = { event: SSEPayload; directory?: string }
type State = { attempts: Set<number>; stopped: boolean; buffered: Buffered[]; generation: number; idle: boolean }

export class ExplicitAbortState {
  private readonly active = new Set<string>()
  private readonly states = new Map<string, State>()
  private readonly generations = new Map<string, number>()
  private next = 0

  begin(sessionID: string, directory: string): number | undefined {
    const key = scope(sessionID, directory)
    if (!this.active.has(key)) return
    const id = ++this.next
    const state = this.states.get(key) ?? {
      attempts: new Set(),
      stopped: false,
      buffered: [],
      generation: this.generations.get(key) ?? 0,
      idle: false,
    }
    state.attempts.add(id)
    this.states.set(key, state)
    return id
  }

  finish(sessionID: string, directory: string, id: number | undefined, stopped: boolean): Buffered[] {
    if (id === undefined) return []
    const key = scope(sessionID, directory)
    const state = this.states.get(key)
    if (!state || !state.attempts.delete(id)) return []
    if (stopped) {
      state.stopped = true
      state.buffered = []
      return []
    }
    if (state.stopped || state.attempts.size > 0) return []
    this.states.delete(key)
    return state.buffered
  }

  event(event: SSEPayload, directory?: string): boolean {
    if (event.type === "session.status" && directory) return this.status(event, directory)
    if (event.type === "session.turn.open") return this.open(event.properties.sessionID, directory)
    if (event.type !== "session.turn.close") return true
    const keys = this.keys(event.properties.sessionID, directory).filter((key) => this.states.has(key))
    if (keys.length !== 1) return true
    const key = keys[0]
    const state = this.states.get(key)
    if (!state) return true
    if (state.generation !== (this.generations.get(key) ?? 0) || event.properties.reason !== "interrupted") {
      this.states.delete(key)
      return true
    }
    if (state.stopped) return false
    if (state.attempts.size === 0) {
      this.states.delete(key)
      return true
    }
    state.buffered.push({ event, directory })
    return false
  }

  private status(event: Extract<SSEPayload, { type: "session.status" }>, directory: string) {
    const key = scope(event.properties.sessionID, directory)
    const state = this.states.get(key)
    if (event.properties.status.type === "idle") {
      this.active.delete(key)
      if (state) state.idle = true
      return true
    }
    this.active.add(key)
    if (state?.idle) this.states.delete(key)
    return true
  }

  private open(sessionID: string, directory?: string) {
    for (const key of this.keys(sessionID, directory)) {
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
      this.states.delete(key)
    }
    return true
  }

  clear() {
    this.active.clear()
    this.states.clear()
    this.generations.clear()
  }

  remove(sessionID: string) {
    for (const key of this.keys(sessionID)) {
      this.active.delete(key)
      this.states.delete(key)
      this.generations.delete(key)
    }
  }

  private keys(sessionID: string, directory?: string): string[] {
    if (directory) return [scope(sessionID, directory)]
    const prefix = `${sessionID}\0`
    return [...new Set([...this.active, ...this.states.keys(), ...this.generations.keys()])].filter((key) =>
      key.startsWith(prefix),
    )
  }
}

function scope(sessionID: string, directory: string) {
  return `${sessionID}\0${path.resolve(directory)}`
}
