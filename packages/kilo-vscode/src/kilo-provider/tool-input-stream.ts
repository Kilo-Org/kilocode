import type { PartUpdate } from "../shared/stream-messages"
import { partial } from "./partial-json"

type Tool = {
  id: string
  sessionID: string
  messageID: string
  callID: string
  tool: string
  type: "tool"
  state: { status: string; input?: Record<string, unknown>; metadata?: Record<string, unknown> }
}

type Shown = { input: Record<string, unknown>; lines?: number }

type Call = { part?: Tool; raw: string; timer?: ReturnType<typeof setTimeout>; shown?: Shown; key?: string }

// Streamed input is parsed at most this often per call. The session stream
// scheduler then coalesces the pending part update with the rest of the frame.
const INTERVAL = 50
// Keep at most this many open calls, so an aborted stream cannot grow the map.
const CAP = 50
// Strings that show while they stream. Other fields show once complete.
const LIVE = new Set(["content", "command"])
// Large fields the webview does not render while a call is pending.
const HIDDEN = new Set(["oldString", "newString", "patchText", "edits"])
const CHARS = 2400
const TAIL = 12

function tool(part: unknown): part is Tool {
  if (!part || typeof part !== "object") return false
  const obj = part as Record<string, unknown>
  return obj.type === "tool" && typeof obj.callID === "string" && !!obj.state && typeof obj.state === "object"
}

// Count lines like the final diff: a trailing newline does not start a new line.
function lines(text: string) {
  if (!text) return 0
  let count = text.endsWith("\n") ? 0 : 1
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) count++
  return count
}

function tail(text: string) {
  let at = text.length
  for (let i = 0; i < TAIL && at > 0; i++) at = text.lastIndexOf("\n", at - 1)
  const start = Math.max(at + 1, text.length - CHARS)
  return text.slice(start)
}

function shape(name: string, input: Record<string, unknown>): Shown {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (HIDDEN.has(key)) continue
    next[key] = typeof value === "string" && key !== "content" && value.length > CHARS ? value.slice(0, CHARS) : value
  }
  const content = input.content
  if (name !== "write" || typeof content !== "string") return { input: next }
  return { input: { ...next, content: tail(content) }, lines: lines(content) }
}

function show<T extends Tool>(part: T, shown: Shown, merge: boolean): T {
  const input = merge ? { ...part.state.input, content: shown.input.content } : shown.input
  const metadata = shown.lines === undefined ? part.state.metadata : { ...part.state.metadata, lines: shown.lines }
  return { ...part, state: { ...part.state, input, ...(metadata ? { metadata } : {}) } }
}

/**
 * Turns streamed tool input fragments into pending part updates, so a tool
 * row shows its file path, command, or written content while the model still
 * generates the arguments. A running `write` keeps the last streamed content
 * tail, because part updates strip the full content.
 */
export class ToolInputStream {
  private readonly calls = new Map<string, Call>()

  constructor(private readonly push: (update: PartUpdate) => void) {}

  /** Watch a tool part update. Returns the part to forward to the webview. */
  track<T>(part: T): T {
    if (!tool(part)) return part
    const call = this.calls.get(part.callID)
    const status = part.state.status
    if (status === "pending") {
      if (!call) {
        this.open(part.callID).part = part
        return part
      }
      call.part = part
      // Fragments can arrive before the part that owns them.
      if (call.raw && !call.shown) this.schedule(part.callID, call)
      return call.shown ? show(part, call.shown, false) : part
    }
    if (!call) return part
    if (call.timer) clearTimeout(call.timer)
    call.timer = undefined
    if (status !== "running" || part.tool !== "write" || !call.shown) {
      this.calls.delete(part.callID)
      return part
    }
    call.part = part
    return show(part, call.shown, true)
  }

  /** Add one input fragment for a call that has not started to run. */
  delta(props: { callID: string; delta: string }) {
    const call = this.calls.get(props.callID) ?? this.open(props.callID)
    if (call.part && call.part.state.status !== "pending") return
    call.raw += props.delta
    if (call.part) this.schedule(props.callID, call)
  }

  dispose() {
    for (const call of this.calls.values()) if (call.timer) clearTimeout(call.timer)
    this.calls.clear()
  }

  private open(id: string) {
    const call: Call = { raw: "" }
    this.calls.set(id, call)
    if (this.calls.size <= CAP) return call
    const first = this.calls.keys().next().value
    if (first !== undefined) this.drop(first)
    return call
  }

  private schedule(id: string, call: Call) {
    call.timer ??= setTimeout(() => this.flush(id), INTERVAL)
  }

  private drop(id: string) {
    const call = this.calls.get(id)
    if (call?.timer) clearTimeout(call.timer)
    this.calls.delete(id)
  }

  private flush(id: string) {
    const call = this.calls.get(id)
    if (!call) return
    call.timer = undefined
    const part = call.part
    if (!part || part.state.status !== "pending") return
    const input = partial(call.raw, LIVE)
    if (!input) return
    const shown = shape(part.tool, input)
    const key = JSON.stringify(shown)
    if (key === call.key) return
    call.key = key
    call.shown = shown
    this.push({
      type: "partUpdated",
      sessionID: part.sessionID,
      messageID: part.messageID,
      part: show(part, shown, false),
    })
  }
}
