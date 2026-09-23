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

type StreamChanges = { additions: number; deletions: number }

type Shown = { input: Record<string, unknown>; changes?: StreamChanges }

type Call = { part?: Tool; raw: string; timer?: ReturnType<typeof setTimeout>; shown?: Shown; key?: string }

// Streamed input is parsed at most this often per call. The session stream
// scheduler then coalesces the pending part update with the rest of the frame.
const INTERVAL = 50
// Keep at most this many open calls, so an aborted stream cannot grow the map.
const CAP = 50
// Strings that count while they stream. Other fields show once complete.
const LIVE = new Set(["content", "command", "oldString", "newString", "patchText"])
// Large fields the webview does not render while a call is pending. They only
// feed the provisional diff count, so the header grows without sending text.
const HIDDEN = new Set(["content", "oldString", "newString", "patchText", "edits"])
// Tools whose streamed input can show a provisional diff count before the
// final filediff or files metadata arrives.
const COUNTED = new Set(["write", "edit", "apply_patch"])
const CHARS = 2400

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

// Count added and removed lines in a streamed patch. The `+++` and `---` file
// headers are not changes, so they are skipped.
function patch(text: string): StreamChanges {
  let additions = 0
  let deletions = 0
  for (const line of text.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) additions++
    else if (line.startsWith("-")) deletions++
  }
  return { additions, deletions }
}

// A provisional diff count from the arguments streamed so far. It can differ
// from the final metadata because of context, replaceAll, or formatting.
function counts(name: string, input: Record<string, unknown>): StreamChanges | undefined {
  if (name === "write") {
    const content = input.content
    return typeof content === "string" ? { additions: lines(content), deletions: 0 } : undefined
  }
  if (name === "edit") {
    const before = input.oldString
    const after = input.newString
    if (typeof before !== "string" && typeof after !== "string") return undefined
    return {
      additions: lines(typeof after === "string" ? after : ""),
      deletions: lines(typeof before === "string" ? before : ""),
    }
  }
  if (name === "apply_patch") {
    const text = input.patchText
    return typeof text === "string" ? patch(text) : undefined
  }
  return undefined
}

function shape(name: string, input: Record<string, unknown>): Shown {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (HIDDEN.has(key)) continue
    next[key] = typeof value === "string" && value.length > CHARS ? value.slice(0, CHARS) : value
  }
  return { input: next, changes: counts(name, input) }
}

function show<T extends Tool>(part: T, shown: Shown, merge: boolean): T {
  const input = merge ? part.state.input : shown.input
  const metadata =
    shown.changes === undefined ? part.state.metadata : { ...part.state.metadata, streamChanges: shown.changes }
  return { ...part, state: { ...part.state, input, ...(metadata ? { metadata } : {}) } }
}

/**
 * Turns streamed tool input fragments into pending part updates, so a tool
 * row shows its file path, command, or a provisional diff count while the
 * model still generates the arguments. A running write, edit, or apply_patch
 * keeps the count until its final diff arrives.
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
    if (status !== "running" || !COUNTED.has(part.tool) || call.shown?.changes === undefined) {
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
