import { Bus } from "@/bus"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Log } from "@/util/log"

const log = Log.create({ service: "workflow.session-bridge" })

export type SessionBridgeCallbacks = {
  onOutput: (sessionId: string, taskId: string, line: string) => void
  onStatusChange: (
    sessionId: string,
    status: "running" | "completed" | "failed" | "escalated",
  ) => void
}

type WatchedSession = {
  sessionId: string
  taskId: string
  unsubscribers: Array<() => void>
}

/**
 * Bridges child session Bus events into callback functions.
 * The TUI context wires these callbacks to its SolidJS store
 * to update the workflow dashboard in real time.
 */
export class SessionBridge {
  private callbacks: SessionBridgeCallbacks
  private watched = new Map<string, WatchedSession>()

  constructor(callbacks: SessionBridgeCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Start watching a child session's events.
   */
  watch(sessionId: string, taskId: string): void {
    if (this.watched.has(sessionId)) return

    log.info("watching session", { sessionId, taskId })

    const unsubscribers: Array<() => void> = []

    // Subscribe to turn close events (completion/failure)
    unsubscribers.push(
      Bus.subscribe(Session.Event.TurnClose, (event) => {
        if (event.properties.sessionID !== sessionId) return

        const reason = event.properties.reason
        const status = reason === "completed" ? "completed" : reason === "interrupted" ? "failed" : "failed"

        log.info("session turn closed", { sessionId, taskId, reason, status })
        this.callbacks.onStatusChange(sessionId, status)
      }),
    )

    // Subscribe to error events
    unsubscribers.push(
      Bus.subscribe(Session.Event.Error, (event) => {
        if (event.properties.sessionID !== sessionId) return

        log.info("session error", { sessionId, taskId })
        this.callbacks.onStatusChange(sessionId, "failed")
      }),
    )

    // Subscribe to session updates for title changes (still useful for tab labels).
    unsubscribers.push(
      Bus.subscribe(Session.Event.Updated, (event) => {
        if (event.properties.info.id !== sessionId) return
        const title = event.properties.info.title
        if (title) {
          this.callbacks.onOutput(sessionId, taskId, title)
        }
      }),
    )

    // devilcode_change start - audit MA8: stream actual message text deltas to onOutput so
    // the workflow TUI shows real progress instead of only the static title.
    let lastTextById: Record<string, string> = {}
    unsubscribers.push(
      Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
        const part = event.properties.part
        if (part.sessionID !== sessionId) return
        if (part.type !== "text" || typeof (part as { text?: string }).text !== "string") return
        const next = (part as { text: string }).text
        const prev = lastTextById[part.id] ?? ""
        if (next === prev) return
        // Only emit the new tail to avoid resending the full message on every update.
        const delta = next.startsWith(prev) ? next.slice(prev.length) : next
        lastTextById[part.id] = next
        if (delta.length > 0) {
          this.callbacks.onOutput(sessionId, taskId, delta)
        }
      }),
    )
    // devilcode_change end

    this.watched.set(sessionId, { sessionId, taskId, unsubscribers })
  }

  /**
   * Stop watching a specific session.
   */
  unwatch(sessionId: string): void {
    const entry = this.watched.get(sessionId)
    if (!entry) return

    log.info("unwatching session", { sessionId, taskId: entry.taskId })
    for (const unsub of entry.unsubscribers) {
      unsub()
    }
    this.watched.delete(sessionId)
  }

  /**
   * Stop watching all sessions. Call on workflow reset or stage transition.
   */
  unwatchAll(): void {
    for (const [sessionId] of this.watched) {
      this.unwatch(sessionId)
    }
  }

  /**
   * Get the task ID associated with a watched session.
   */
  getTaskId(sessionId: string): string | undefined {
    return this.watched.get(sessionId)?.taskId
  }

  /**
   * Check if a session is being watched.
   */
  isWatching(sessionId: string): boolean {
    return this.watched.has(sessionId)
  }
}
