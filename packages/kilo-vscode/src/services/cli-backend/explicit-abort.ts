import path from "node:path"
import type { SSEPayload } from "./sdk-sse-adapter"

type Buffered = { event: SSEPayload; directory?: string }
type State = { attempts: Set<number>; stopped: boolean; buffered?: Buffered; idle: boolean }

export class ExplicitAbortState {
  private readonly states = new Map<string, State>()
  private next = 0

  begin(sessionID: string, directory: string): number {
    const key = scope(sessionID, directory)
    const id = ++this.next
    const state = this.states.get(key) ?? { attempts: new Set<number>(), stopped: false, idle: false }
    state.attempts.add(id)
    this.states.set(key, state)
    return id
  }

  finish(sessionID: string, directory: string, id: number, stopped: boolean): Buffered[] {
    const key = scope(sessionID, directory)
    const state = this.states.get(key)
    if (!state || !state.attempts.delete(id)) return []
    if (stopped) {
      if (state.buffered) this.states.delete(key)
      else state.stopped = true
      return []
    }
    if (state.stopped || state.attempts.size > 0) return []
    this.states.delete(key)
    return state.buffered ? [state.buffered] : []
  }

  event(event: SSEPayload, directory?: string): boolean {
    if (event.type === "session.status" && directory) {
      const key = scope(event.properties.sessionID, directory)
      const state = this.states.get(key)
      if (!state) return true
      if (event.properties.status.type === "idle") state.idle = true
      else if (state.idle) this.states.delete(key)
      return true
    }
    if (event.type === "session.turn.open") {
      for (const key of this.keys(event.properties.sessionID, directory)) this.states.delete(key)
      return true
    }
    if (event.type !== "session.turn.close") return true
    const keys = this.keys(event.properties.sessionID, directory)
    if (keys.length !== 1) return true
    const key = keys[0]!
    const state = this.states.get(key)
    if (!state) return true
    if (event.properties.reason !== "interrupted") {
      this.states.delete(key)
      return true
    }
    if (state.stopped) {
      this.states.delete(key)
      return false
    }
    state.buffered ??= { event, directory }
    return false
  }

  clear() {
    this.states.clear()
  }

  remove(sessionID: string) {
    for (const key of this.keys(sessionID)) this.states.delete(key)
  }

  private keys(sessionID: string, directory?: string): string[] {
    if (directory) {
      const key = scope(sessionID, directory)
      return this.states.has(key) ? [key] : []
    }
    const prefix = `${sessionID}\0`
    return [...this.states.keys()].filter((key) => key.startsWith(prefix))
  }
}

function scope(sessionID: string, directory: string) {
  const dir = path.resolve(directory)
  return `${sessionID}\0${process.platform === "win32" ? dir.toLowerCase() : dir}`
}
