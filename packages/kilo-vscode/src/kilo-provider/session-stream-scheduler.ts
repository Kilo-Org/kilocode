/**
 * Session-aware streaming scheduler.
 *
 * Sits between SSE events and the webview `postMessage` path. Coalesces
 * repeated `partUpdated` events for the same `(sessionID, messageID, partID)`
 * tuple, prioritizes the focused session, and throttles background sessions
 * so multi-agent streaming doesn't saturate the renderer main thread.
 *
 * See the tuning comment on the default constants below for rationale.
 */

import type { PartBatch, PartUpdate } from "../shared/stream-messages"
export type { PartBatch, PartUpdate } from "../shared/stream-messages"

export type StreamSchedulerStats = {
  received: number
  emitted: number
  batches: number
  active: number
  background: number
}

export type StreamSchedulerOptions = {
  /** Flush cadence for the focused/active session. Defaults to 16ms. */
  activeMs?: number
  /** Base background cadence. Defaults to 150ms. */
  backgroundBaseMs?: number
  /**
   * Additional ms per background session above the first 2 (adaptive throttle).
   * 10 background sessions → base + 8 * step. Defaults to 20ms.
   */
  backgroundStepMs?: number
  /** Hard cap for the background cadence. Defaults to 400ms. */
  backgroundMaxMs?: number
}

// Scheduler tuning — rationale:
//
// These defaults balance perceived streaming smoothness against renderer pressure.
// The scheduler sits between SSE (dozens to hundreds of deltas per second per session)
// and the webview message loop, which applies updates through Solid `batch()` and
// triggers DOM / style / layout work on the renderer main thread.
//
// - DEFAULT_ACTIVE_MS = 16
//   One 60Hz animation frame. The focused session should feel indistinguishable
//   from immediate streaming, so we coalesce within a single paint window but no
//   longer. Raising this to 32ms visibly stutters live text; lowering below ~8ms
//   stops coalescing meaningfully because SSE delta arrival is already ~10-20ms
//   apart at typical model rates.
//
// - DEFAULT_BG_BASE_MS = 150
//   Background (non-focused) sessions don't need frame-perfect updates — the user
//   can't see their content. 150ms keeps tab-status signals (spinner motion,
//   token counts via related events) feeling alive while collapsing most
//   per-token deltas into a single batched emission. Under 100ms the coalescing
//   win shrinks; over ~250ms users start perceiving lag when switching tabs
//   mid-stream (though `focus()` also immediately flushes, so this is mostly a
//   concern for users watching tab-level indicators).
//
// - DEFAULT_BG_STEP_MS = 20
//   Per-extra-background-session backoff beyond the first 2. Each additional
//   streaming agent adds ~20ms to the background interval so total background
//   message throughput stays roughly flat as the agent count grows. Without this,
//   10 concurrent agents would put the same ~7 msg/sec pressure per-session on
//   the renderer as 1 agent does (~70 msg/sec total background).
//
// - DEFAULT_BG_MAX_MS = 400
//   Ceiling for the adaptive backoff. Even with 20+ agents streaming we never
//   stall background emissions longer than 400ms, which keeps tab indicators
//   recognizably "live" and keeps the `drop()`-on-delete path timely. Above
//   ~500ms the UI starts feeling disconnected; below 300ms the many-agent
//   backoff stops providing meaningful throttling.
const DEFAULT_ACTIVE_MS = 16
const DEFAULT_BG_BASE_MS = 150
const DEFAULT_BG_STEP_MS = 20
const DEFAULT_BG_MAX_MS = 400

function partField(part: unknown, key: string): unknown {
  if (!part || typeof part !== "object") return undefined
  return (part as Record<string, unknown>)[key]
}

function appendPart(part: unknown, text: string): unknown {
  if (!part || typeof part !== "object") return part
  const item = part as Record<string, unknown>
  if ((item.type !== "text" && item.type !== "reasoning") || typeof item.text !== "string") return part
  return { ...item, text: item.text + text }
}

function partUpdateKey(msg: PartUpdate): string | undefined {
  const id = partField(msg.part, "id")
  const mid = msg.messageID || partField(msg.part, "messageID")
  if (typeof id !== "string" || !id) return undefined
  if (typeof mid !== "string" || !mid) return undefined
  return `${msg.sessionID}:${mid}:${id}`
}

function mergePartUpdate(prev: PartUpdate | undefined, msg: PartUpdate): PartUpdate {
  if (!prev) return msg
  const text = msg.delta?.textDelta
  if (!text) return msg.delta ? prev : msg
  if (!prev.delta) return { ...prev, part: appendPart(prev.part, text) }
  return {
    ...prev,
    part: appendPart(prev.part, text),
    delta: { type: "text-delta", textDelta: `${prev.delta.textDelta}${text}` },
  }
}

export class SessionStreamScheduler {
  private active: string | undefined
  private atimer: ReturnType<typeof setTimeout> | null = null
  private btimer: ReturnType<typeof setTimeout> | null = null
  private bgFirstQueuedAt = 0
  private readonly queues = new Map<string, Map<string, PartUpdate>>()
  private readonly activeMs: number
  private readonly bgBase: number
  private readonly bgStep: number
  private readonly bgMax: number
  private readonly counters: StreamSchedulerStats = {
    received: 0,
    emitted: 0,
    batches: 0,
    active: 0,
    background: 0,
  }

  constructor(
    private readonly send: (msg: PartUpdate | PartBatch) => void,
    opts?: StreamSchedulerOptions,
  ) {
    this.activeMs = opts?.activeMs ?? DEFAULT_ACTIVE_MS
    this.bgBase = opts?.backgroundBaseMs ?? DEFAULT_BG_BASE_MS
    this.bgStep = opts?.backgroundStepMs ?? DEFAULT_BG_STEP_MS
    this.bgMax = opts?.backgroundMaxMs ?? DEFAULT_BG_MAX_MS
  }

  focus(sessionID?: string): void {
    if (this.active === sessionID) return
    const prev = this.active
    if (this.atimer) {
      clearTimeout(this.atimer)
      this.atimer = null
    }
    this.active = sessionID
    if (prev && this.queues.get(prev)?.size) this.scheduleBackground()
    if (sessionID) this.flush(sessionID)
  }

  push(msg: PartUpdate): void {
    this.counters.received++
    const key = partUpdateKey(msg)
    if (!key) {
      // Non-keyable updates can't be merged. Flush pending first to preserve order.
      this.flush(msg.sessionID)
      this.emitOne(msg)
      return
    }

    const queue = this.ensureQueue(msg.sessionID)
    const prev = queue.get(key)
    // A full-part replacement after buffered deltas would lose information; flush first.
    if (prev?.delta && !msg.delta) {
      this.flush(msg.sessionID)
      this.ensureQueue(msg.sessionID).set(key, msg)
    } else {
      queue.set(key, mergePartUpdate(prev, msg))
    }
    this.schedule(msg.sessionID)
  }

  flush(sessionID?: string): void {
    if (!sessionID) {
      this.clearTimers()
      this.emit(this.takeAll())
      return
    }

    if (this.active === sessionID && this.atimer) {
      clearTimeout(this.atimer)
      this.atimer = null
    }

    this.emit(this.take(sessionID))

    if (this.btimer && !this.hasBackground()) {
      clearTimeout(this.btimer)
      this.btimer = null
    }
  }

  /**
   * Discard any queued updates for a session without emitting them.
   *
   * Called when an authoritative snapshot supersedes buffered deltas
   * (messagesLoaded fetch) or when a session is deleted. Does NOT alter focus
   * state — callers that also want to clear focus should call `focus(undefined)`
   * themselves. A pending active-lane timer is left to fire harmlessly
   * (`take()` returns `[]` for the emptied queue).
   */
  drop(sessionID: string): void {
    this.queues.delete(sessionID)
    if (this.btimer && !this.hasBackground()) {
      clearTimeout(this.btimer)
      this.btimer = null
    }
  }

  dispose(): void {
    this.clearTimers()
    this.queues.clear()
  }

  stats(): Readonly<StreamSchedulerStats> {
    return this.counters
  }

  private ensureQueue(sid: string): Map<string, PartUpdate> {
    const existing = this.queues.get(sid)
    if (existing) return existing
    const queue = new Map<string, PartUpdate>()
    this.queues.set(sid, queue)
    return queue
  }

  private schedule(sessionID: string): void {
    if (!this.queues.get(sessionID)?.size) return
    if (this.active === sessionID) {
      if (this.atimer) return
      this.atimer = setTimeout(() => this.flushActive(), this.activeMs)
      return
    }
    this.scheduleBackground()
  }

  private scheduleBackground(): void {
    const count = this.backgroundCount()
    if (count === 0) return
    const now = Date.now()
    if (!this.btimer) this.bgFirstQueuedAt = now
    const elapsed = now - this.bgFirstQueuedAt
    const extra = Math.max(0, count - 2) * this.bgStep
    const target = Math.min(this.bgMax, this.bgBase + extra)
    // Never defer past backgroundMaxMs from when the first update landed.
    // Each push can extend the timer up to that hard cap as the session count grows.
    const remaining = Math.max(0, Math.min(target - elapsed, this.bgMax - elapsed))
    if (this.btimer) clearTimeout(this.btimer)
    this.btimer = setTimeout(() => this.flushBackground(), remaining)
  }

  private flushActive(): void {
    this.atimer = null
    if (this.active) this.emit(this.take(this.active))
  }

  private flushBackground(): void {
    this.btimer = null
    this.bgFirstQueuedAt = 0
    this.emit(this.takeBackground())
  }

  private take(sessionID: string): PartUpdate[] {
    const queue = this.queues.get(sessionID)
    if (!queue) return []
    this.queues.delete(sessionID)
    return [...queue.values()]
  }

  private takeAll(): PartUpdate[] {
    const updates = [...this.queues.values()].flatMap((queue) => [...queue.values()])
    this.queues.clear()
    return updates
  }

  private takeBackground(): PartUpdate[] {
    const updates: PartUpdate[] = []
    for (const [sid, queue] of this.queues) {
      if (sid === this.active) continue
      updates.push(...queue.values())
      this.queues.delete(sid)
    }
    return updates
  }

  private backgroundCount(): number {
    let n = 0
    for (const [sid, queue] of this.queues) {
      if (sid !== this.active && queue.size > 0) n++
    }
    return n
  }

  private hasBackground(): boolean {
    return this.backgroundCount() > 0
  }

  private emit(updates: PartUpdate[]): void {
    if (updates.length === 0) return
    if (updates.length === 1) {
      this.emitOne(updates[0]!)
      return
    }
    this.counters.emitted += updates.length
    this.counters.batches++
    this.countLane(updates[0]!.sessionID)
    this.send({ type: "partsUpdated", updates })
  }

  private emitOne(msg: PartUpdate): void {
    this.counters.emitted++
    this.counters.batches++
    this.countLane(msg.sessionID)
    this.send(msg)
  }

  private countLane(sessionID: string): void {
    if (sessionID === this.active) this.counters.active++
    else this.counters.background++
  }

  private clearTimers(): void {
    if (this.atimer) clearTimeout(this.atimer)
    this.atimer = null
    if (this.btimer) clearTimeout(this.btimer)
    this.btimer = null
  }
}
