import {
  DEFAULT_STALL_AFTER_MS,
  FOUNDATION_EVENT,
  canSafelyResume,
  mapKiloRuntimeActivity,
  mapKiloRuntimeStatus,
  recordStall,
  scanSessionStalls,
  type SessionProgress,
} from "@kilocode/kilo-foundation"
import { managedInbox } from "./managed-delivery"

const DEFAULT_SCAN_EVERY_MS = 60_000

export interface SessionStallWatchdogOptions {
  stallAfterMs?: number
  scanEveryMs?: number
  now?: () => Date
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
  onStall?: (sessionId: string, resumable: boolean) => void
}

/**
 * Clock-based stall scan for Agent Manager. Last progress comes from
 * `session.status` SSE events. Does not poll an LLM or session HTTP API.
 */
export class SessionStallWatchdog {
  private readonly sessions = new Map<string, SessionProgress>()
  private readonly reported = new Set<string>()
  private readonly stallAfterMs: number
  private readonly scanEveryMs: number
  private readonly now: () => Date
  private readonly setIntervalFn: typeof setInterval
  private readonly clearIntervalFn: typeof clearInterval
  private readonly onStall?: (sessionId: string, resumable: boolean) => void
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(opts: SessionStallWatchdogOptions = {}) {
    this.stallAfterMs = opts.stallAfterMs ?? DEFAULT_STALL_AFTER_MS
    this.scanEveryMs = opts.scanEveryMs ?? DEFAULT_SCAN_EVERY_MS
    this.now = opts.now ?? (() => new Date())
    this.setIntervalFn = opts.setIntervalFn ?? setInterval
    this.clearIntervalFn = opts.clearIntervalFn ?? clearInterval
    this.onStall = opts.onStall
  }

  noteStatus(sessionId: string, runtimeType: string, directory?: string, nowIso = this.now().toISOString()): void {
    const activity = mapKiloRuntimeActivity(runtimeType)
    this.reported.delete(sessionId)
    if (activity === "idle" || activity === "stopped") {
      this.sessions.delete(sessionId)
      return
    }
    this.sessions.set(sessionId, {
      sessionId,
      activity,
      lastProgressIso: nowIso,
      directory,
    })
  }

  forget(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.reported.delete(sessionId)
  }

  scan(nowIso = this.now().toISOString()): SessionProgress[] {
    const stalled = scanSessionStalls([...this.sessions.values()], nowIso, this.stallAfterMs)
    for (const session of stalled) {
      if (this.reported.has(session.sessionId)) continue
      this.reported.add(session.sessionId)
      recordStall(managedInbox.telemetry)
      managedInbox.enqueueFoundationEvent(
        FOUNDATION_EVENT.STALLED,
        session.sessionId,
        {
          lastProgressIso: session.lastProgressIso,
          directory: session.directory,
          kind: "stall",
        },
        nowIso,
      )
      const resumable = resumableAfterStall(session.activity)
      if (resumable) {
        managedInbox.enqueueFoundationEvent(
          FOUNDATION_EVENT.RESUMABLE,
          session.sessionId,
          {
            directory: session.directory,
            kind: "resume",
          },
          nowIso,
        )
      }
      this.onStall?.(session.sessionId, resumable)
    }
    return stalled
  }

  start(): void {
    if (this.timer) return
    this.timer = this.setIntervalFn(() => {
      this.scan()
    }, this.scanEveryMs)
  }

  stop(): void {
    if (!this.timer) return
    this.clearIntervalFn(this.timer)
    this.timer = undefined
  }
}

function mapActivityToRuntime(activity: SessionProgress["activity"]): string {
  switch (activity) {
    case "blocked":
      return "offline"
    case "waiting":
      return "retry"
    case "running":
      return "busy"
    default:
      return "idle"
  }
}

/** Resume only for paused/offline stalls, never while still running. */
export function resumableAfterStall(activity: SessionProgress["activity"]): boolean {
  return canSafelyResume(mapKiloRuntimeStatus(mapActivityToRuntime(activity)))
}
