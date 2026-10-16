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
//
// Oversize-line policy: each line is checked on its own. When a line exceeds
// `MAX_WAKE_LINE_BYTES`, it is dropped entirely, a warning is logged once,
// and the engine enters a "drop-mode" for that stream until the next newline.
// Drop-mode exists so a line that arrives split across many chunks cannot
// keep us guessing about its size; once we know it is too long, we stop
// looking at it until the producer signals its end with `\n`. Subsequent
// lines on the same stream are processed normally.

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
  /** The trailing partial line, in FIFO order, for each stream. */
  stdout: string
  stderr: string
}

export type WakeDropping = {
  /** True while the current line is being dropped because it exceeded the cap. */
  stdout: boolean
  stderr: boolean
}

export type WakeState = {
  pattern: RegExp
  cooldownMs: number
  batchMax: number
  decoder: { stdout: StringDecoder; stderr: StringDecoder }
  buffer: WakeBuffer
  /** Per-stream drop-mode flag, set when the current line is oversize. */
  dropping: WakeDropping
  queue: string[]
  lastAt?: number
  dispatching?: boolean
  timer?: ReturnType<typeof setTimeout>
  disposed?: boolean
  overflowed?: boolean
  /** Number of times a single line exceeded `MAX_WAKE_LINE_BYTES`. */
  droppedLines: number
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
    dropping: { stdout: false, stderr: false },
    queue: [],
    droppedLines: 0,
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
 * Lines are evaluated one at a time against `MAX_WAKE_LINE_BYTES`. A line
 * that already exceeds the cap (because it spans multiple chunks) is dropped
 * entirely and a warning is logged once. Dropping continues until the line's
 * terminating newline is observed, after which subsequent lines are processed
 * normally.
 */
export function feed(state: WakeState, source: "stdout" | "stderr", chunk: Buffer | Uint8Array | string): void {
  if (state.disposed) return
  const decoder = state.decoder[source]
  const text = typeof chunk === "string" ? chunk : decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (!text) return
  processText(state, source, text)
}

/**
 * Drive line detection and dispatch from a single UTF-8-decoded text block.
 * Splitting this out from `feed()` keeps the drop-mode / partial-line logic
 * reusable from the `flush()` exit path.
 */
function processText(state: WakeState, source: "stdout" | "stderr", text: string): void {
  let cursor = 0
  while (cursor < text.length) {
    if (state.dropping[source]) {
      // We are inside an overlong line that started in a previous chunk
      // and whose terminating newline has not yet been observed. Scan
      // forward for that newline and ignore everything up to (and
      // including) it. The first character after the newline starts a
      // fresh line and will be processed normally on the next loop pass.
      const nl = text.indexOf("\n", cursor)
      if (nl === -1) return
      state.dropping[source] = false
      cursor = nl + 1
      continue
    }
    const nl = text.indexOf("\n", cursor)
    if (nl === -1) {
      // No newline yet; the rest of `text` extends the pending partial line.
      const candidate = state.buffer[source] + text.slice(cursor)
      const bytes = Buffer.byteLength(candidate, "utf8")
      if (bytes > MAX_WAKE_LINE_BYTES) {
        // The current line is too long and we have not yet seen its
        // terminating newline. Enter drop-mode: future chunks that
        // contain more of this same line will be ignored, and we will
        // exit drop-mode the moment we observe the newline.
        enterDropMode(state, source)
        return
      }
      state.buffer[source] = candidate
      return
    }
    // Newline at `nl`: the line runs from state.buffer to `nl`.
    const rawLine = state.buffer[source] + text.slice(cursor, nl)
    state.buffer[source] = ""
    const line = stripTrailingCR(rawLine)
    const bytes = Buffer.byteLength(line, "utf8")
    if (bytes > MAX_WAKE_LINE_BYTES) {
      // The line already exceeded the cap. Its terminating newline is
      // right here at `nl`, so the line is fully contained in this chunk.
      // Drop it as a single atomic unit and resume processing whatever
      // the chunk contains after `nl` - do not enter drop-mode, since
      // the line has already ended.
      dropOversizeLine(state, source)
      cursor = nl + 1
      continue
    }
    if (line) scanLine(state, source, line)
    cursor = nl + 1
  }
}

function stripTrailingCR(value: string): string {
  return value.length > 0 && value.charCodeAt(value.length - 1) === 0x0d ? value.slice(0, -1) : value
}

/**
 * Enter drop-mode for a stream. Used when we know the current line is too
 * long and have not yet seen its terminating newline - we will keep
 * ignoring bytes for that line until a newline arrives. Calling this is
 * idempotent: the warning is logged once per line, and `dropping` is only
 * flipped if it is not already set.
 */
function enterDropMode(state: WakeState, source: "stdout" | "stderr"): void {
  if (state.dropping[source]) return
  state.overflowed = true
  state.droppedLines++
  state.dropping[source] = true
  state.buffer[source] = ""
  state.log("warn", "wake line exceeded max length; dropping until newline", {
    source,
    max: MAX_WAKE_LINE_BYTES,
  })
}

/**
 * Drop a single overlong line whose terminating newline is already in the
 * current chunk. Unlike `enterDropMode` this does not flip `dropping` on,
 * because the line has already ended: subsequent bytes belong to a new
 * line that should be processed normally.
 */
function dropOversizeLine(state: WakeState, source: "stdout" | "stderr"): void {
  state.overflowed = true
  state.droppedLines++
  state.buffer[source] = ""
  state.log("warn", "wake line exceeded max length; dropping", {
    source,
    max: MAX_WAKE_LINE_BYTES,
  })
}

/**
 * Run the pattern against `line`. `feed()` is responsible for size checks;
 * an oversized line should never reach this function.
 */
function scanLine(state: WakeState, source: "stdout" | "stderr", line: string): void {
  if (!line) return
  if (Buffer.byteLength(line, "utf8") > MAX_WAKE_LINE_BYTES) {
    // Defensive: an oversized line leaked through. Drop it instead of
    // truncating - a truncated fragment is worse than no event.
    enterDropMode(state, source)
    return
  }
  if (!state.pattern.test(line)) return
  enqueue(state, line)
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
 *
 * If the engine is in drop-mode for a stream, the leftover is the tail of an
 * oversize line and is therefore discarded silently; the producer never
 * terminated it.
 */
export function flush(state: WakeState): void {
  if (state.disposed) return
  for (const source of ["stdout", "stderr"] as const) {
    const tail = state.decoder[source].end()
    if (state.dropping[source]) {
      // Tail of an oversize line; drop it without surfacing. Drop-mode is
      // cleared so a second flush is a no-op rather than leaving the stream
      // in a perpetually dropped state.
      state.dropping[source] = false
      state.buffer[source] = ""
      continue
    }
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
  state.dropping = { stdout: false, stderr: false }
}
