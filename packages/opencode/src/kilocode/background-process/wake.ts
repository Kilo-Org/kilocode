// kilocode_change - new file
//
// Wake detection for background processes. Splits stdout/stderr into complete
// lines, matches each against a regex, queues matches through a FIFO, and
// dispatches batches through an injectable `fire` function while honouring a
// minimum cooldown between batches.
//
// The module deliberately keeps zero coupling to SessionPrompt or the rest of
// the package: tests can supply a `fire` implementation that records calls.
// The owner (`background-process/index.ts`) handles process lifecycle and the
// actual SessionPrompt integration.

import { StringDecoder } from "node:string_decoder"

export const MAX_WAKE_LINE_BYTES = 64 * 1024
export const MAX_WAKE_QUEUE = 1000
export const DEFAULT_WAKE_COOLDOWN_MS = 1_000
export const DEFAULT_WAKE_BATCH_MAX = 50

export type WakeFireInput = {
  /** Matching lines, in FIFO order, as they were seen on the stream. */
  lines: string[]
}

export type WakeFire = (input: WakeFireInput) => Promise<void>

export type WakeLog = (level: "info" | "warn" | "debug", message: string, meta?: Record<string, unknown>) => void

export type WakeOptions = {
  pattern: RegExp
  cooldownMs?: number
  batchMax?: number
  fire: WakeFire
  log?: WakeLog
}

export type WakeBuffer = {
  stdout: string
  stderr: string
}

export type WakeState = {
  pattern: RegExp
  cooldownMs: number
  batchMax: number
  decoder: { stdout: StringDecoder; stderr: StringDecoder }
  buffer: WakeBuffer
  queue: string[]
  lastAt?: number
  dispatching?: boolean
  timer?: ReturnType<typeof setTimeout>
  disposed?: boolean
  overflowed?: boolean
  dropped: number
  batchCalls: number
  fired: number
  fire: WakeFire
  log: WakeLog
}

const noopLog: WakeLog = () => {}

export function createWake(opts: WakeOptions): WakeState {
  return {
    pattern: opts.pattern,
    cooldownMs: opts.cooldownMs ?? DEFAULT_WAKE_COOLDOWN_MS,
    batchMax: opts.batchMax ?? DEFAULT_WAKE_BATCH_MAX,
    decoder: { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") },
    buffer: { stdout: "", stderr: "" },
    queue: [],
    dropped: 0,
    batchCalls: 0,
    fired: 0,
    fire: opts.fire,
    log: opts.log ?? noopLog,
  }
}

/**
 * Feed one chunk of bytes for a single stream. The chunk may end mid-line or
 * mid-UTF-8-sequence; partial UTF-8 is preserved by the StringDecoder and held
 * until the next chunk.
 *
 * The trailing per-stream buffer is bounded. If a process emits more than
 * `MAX_WAKE_LINE_BYTES` of text without a newline, we drop the oldest bytes
 * (a sliding window) and log a warning. Truncated tails are NOT evaluated
 * against the pattern; only text the consumer can recognise as a complete
 * line is forwarded.
 */
export function feed(state: WakeState, source: "stdout" | "stderr", chunk: Buffer | Uint8Array | string): void {
  if (state.disposed) return
  const decoder = state.decoder[source]
  const text = typeof chunk === "string" ? chunk : decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!text) return
  // Combine any previously buffered tail with the new text and split.
  const combined = state.buffer[source] + text
  // Enforce the per-line byte ceiling on the buffered tail BEFORE splitting so
  // a runaway producer cannot exhaust memory before a newline arrives.
  if (Buffer.byteLength(combined, "utf8") > MAX_WAKE_LINE_BYTES) {
    state.overflowed = true
    state.log("warn", "wake buffer exceeded max length; truncating tail", {
      source,
      max: MAX_WAKE_LINE_BYTES,
    })
    // Sliding-window keep: hold only the last MAX_WAKE_LINE_BYTES worth of
    // bytes (snapped at a UTF-8 character boundary). The discarded prefix
    // never sees the pattern matcher.
    const buf = Buffer.from(combined, "utf8")
    let start = buf.length - MAX_WAKE_LINE_BYTES
    while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
    const kept = buf.subarray(start).toString("utf8")
    // Re-run the split path on a `kept` that we know is under the limit.
    const parts = kept.split(/\r?\n/)
    state.buffer[source] = parts.pop() ?? ""
    for (const line of parts) {
      if (!line) continue
      scanLine(state, source, line)
    }
    return
  }
  const parts = combined.split(/\r?\n/)
  // Last element is the partial line (possibly empty). Keep it buffered.
  state.buffer[source] = parts.pop() ?? ""
  for (const line of parts) {
    if (!line) continue
    scanLine(state, source, line)
  }
}

/**
 * Run `scan` against `line`, respecting the optional max-byte guard. A line
 * longer than the guard is truncated at a UTF-8-safe boundary and marked with
 * the unicode horizontal-ellipsis so callers know it was clipped.
 */
function scanLine(state: WakeState, source: "stdout" | "stderr", line: string): void {
  if (!line) return
  // `feed()` keeps the trailing partial line under `MAX_WAKE_LINE_BYTES` via
  // its sliding-window path, so this branch only fires when a single chunk
  // already contained a complete line that itself exceeds the cap.
  let target = line
  if (Buffer.byteLength(target, "utf8") > MAX_WAKE_LINE_BYTES) {
    const buf = Buffer.from(target, "utf8")
    let end = MAX_WAKE_LINE_BYTES
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) end++
    target = buf.subarray(0, end).toString("utf8") + "\u2026"
    state.overflowed = true
    state.log("warn", "wake line exceeded max length; truncating", { source, max: MAX_WAKE_LINE_BYTES })
  }
  if (!state.pattern.test(target)) return
  enqueue(state, target)
}

/** Push a matched line onto the FIFO, enforcing the queue bound. */
function enqueue(state: WakeState, line: string): void {
  if (state.disposed) return
  if (state.queue.length >= MAX_WAKE_QUEUE) {
    state.queue.shift()
    state.dropped++
    state.log("warn", "wake queue overflowed; dropped oldest event", { dropped: state.dropped })
  }
  state.queue.push(line)
  schedule(state)
}

/**
 * Schedule a dispatch, respecting the cooldown timer. Cooldown is measured
 * from the most recent successful fire, not from the last schedule.
 */
export function schedule(state: WakeState): void {
  if (state.disposed) return
  if (state.timer) return
  const now = Date.now()
  const remaining = state.lastAt ? Math.max(0, state.cooldownMs - (now - state.lastAt)) : 0
  state.timer = setTimeout(() => {
    state.timer = undefined
    void dispatch(state)
  }, remaining)
}

/**
 * Drain up to `batchMax` events from the FIFO and call `fire`. Success sets
 * `lastAt`; failure re-queues the batch at the head and re-schedules after a
 * short retry delay. Concurrent dispatches are prevented via `dispatching`.
 */
export async function dispatch(state: WakeState): Promise<void> {
  if (state.disposed) return
  if (state.dispatching) return
  if (state.queue.length === 0) return
  state.dispatching = true
  const batch = state.queue.splice(0, state.batchMax)
  let retried = false
  try {
    state.batchCalls++
    await state.fire({ lines: batch })
    state.fired += batch.length
    state.lastAt = Date.now()
  } catch (err) {
    // Put events back at the head, preserving order.
    state.queue.unshift(...batch)
    state.log("warn", "wake batch dispatch failed; re-queued", { size: batch.length, err })
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = undefined
      void dispatch(state)
    }, 250)
    retried = true
  } finally {
    state.dispatching = false
    if (!retried && state.queue.length > 0) schedule(state)
  }
}

/**
 * Drain any buffered partial lines and process them as final lines. Used at
 * process exit so a trailing event without newline still fires. Resets the
 * buffer so exit/close cannot double-deliver.
 */
export function flush(state: WakeState): void {
  if (state.disposed) return
  for (const source of ["stdout", "stderr"] as const) {
    const tail = state.decoder[source].end()
    const text = (state.buffer[source] + tail).trim()
    state.buffer[source] = ""
    if (text) scanLine(state, source, text)
  }
}

/**
 * Force immediate dispatch, ignoring cooldown. Used at process exit to flush
 * any queued events without waiting for the cooldown window to elapse.
 * Concurrency protection still applies.
 */
export async function flushDispatch(state: WakeState): Promise<void> {
  if (state.disposed) return
  if (state.queue.length === 0) return
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = undefined
  }
  await dispatch(state)
}

/** Stop further processing and cancel any pending dispatch. */
export function dispose(state: WakeState): void {
  state.disposed = true
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = undefined
  }
  state.queue = []
  state.buffer = { stdout: "", stderr: "" }
}
