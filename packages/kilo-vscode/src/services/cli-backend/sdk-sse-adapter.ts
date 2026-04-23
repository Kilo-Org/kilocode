import type { KiloClient, GlobalEvent, Event } from "@kilocode/sdk/v2/client"

export type SSEEventHandler = (event: Event) => void
export type SSEErrorHandler = (error: Error) => void
export type SSEStateHandler = (state: "connecting" | "connected" | "disconnected") => void

/**
 * SSE adapter that consumes the SDK's `client.global.event()` AsyncGenerator
 * and distributes events to subscribers via a pub/sub interface.
 *
 * Follows the same reconnection pattern as the app (`packages/app/src/context/global-sdk.tsx`):
 *   - Outer `while (!aborted)` loop for reconnection
 *   - Per-attempt AbortController so heartbeat timeout can cancel a stale connection
 *   - Heartbeat timeout to detect zombie connections
 *
 * In this VS Code extension context the connection is localhost (extension ↔
 * child-process server), so zombie-connection scenarios are less likely than in
 * the web app (which goes through proxies/CDNs). We keep the heartbeat for
 * consistency with the original strategy but use a generous 90 s timeout to
 * avoid false-positive reconnections during idle periods.
 *
 * NOTE on event coalescing:
 * The app batches rapid events into 16 ms windows before flushing to the UI.
 * This adapter preserves raw SSE order for all subscribers; webview providers
 * coalesce high-frequency part updates before calling `postMessage()`.
 */
export class SdkSSEAdapter {
  private readonly handlers = new Set<SSEEventHandler>()
  private readonly errorHandlers = new Set<SSEErrorHandler>()
  private readonly stateHandlers = new Set<SSEStateHandler>()

  private abortController: AbortController | null = null
  private attemptController: AbortController | null = null
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null

  // 15s matches packages/app/src/context/global-sdk.tsx — server sends heartbeats
  // every 10s, so this gives a 5s grace window before forcing a reconnect.
  // Reduced from 90s: with 90s a dead connection could linger for ~1.5 minutes.
  private static readonly HEARTBEAT_TIMEOUT_MS = 15_000
  private static readonly RECONNECT_DELAY_MS = 250

  constructor(private readonly client: KiloClient) {}

  // ── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start consuming the global SSE stream.
   * Calling `connect()` while already connected is a no-op.
   */
  connect(): void {
    if (this.abortController) {
      console.log("[Kilo New] SSE: ⚠️ Already connected, skipping")
      return
    }

    console.log("[Kilo New] SSE: 🔌 connect() called")
    this.abortController = new AbortController()
    console.log('[Kilo New] SSE: 🔄 Setting state to "connecting"')
    this.notifyState("connecting")
    void this.consumeLoop(this.abortController.signal).catch((err) => {
      console.error("[Kilo New] SSE: Unhandled error in consumeLoop:", err)
      this.notifyError(err instanceof Error ? err : new Error(String(err)))
    })
  }

  /**
   * Stop consuming the SSE stream and abort any in-flight request.
   */
  disconnect(): void {
    console.log("[Kilo New] SSE: 🔌 disconnect() called")
    this.abortController?.abort()
    this.abortController = null
    this.attemptController = null
    this.clearHeartbeat()
  }

  /**
   * Force the current SSE attempt to reconnect without killing the outer loop.
   * Aborts only the per-attempt controller so `consumeLoop` re-enters its
   * reconnection path instead of terminating permanently.
   */
  reconnect(): void {
    if (!this.attemptController) {
      console.log("[Kilo New] SSE: ⚠️ reconnect() called but no active attempt")
      return
    }
    console.log("[Kilo New] SSE: 🔄 reconnect() — aborting current attempt")
    this.attemptController.abort()
  }

  /**
   * Disconnect and clear all registered handlers.
   */
  dispose(): void {
    this.disconnect()
    this.handlers.clear()
    this.errorHandlers.clear()
    this.stateHandlers.clear()
  }

  // ── Pub/sub ────────────────────────────────────────────────────────

  onEvent(handler: SSEEventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  onError(handler: SSEErrorHandler): () => void {
    this.errorHandlers.add(handler)
    return () => {
      this.errorHandlers.delete(handler)
    }
  }

  onStateChange(handler: SSEStateHandler): () => void {
    this.stateHandlers.add(handler)
    return () => {
      this.stateHandlers.delete(handler)
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  /**
   * Main reconnection loop — mirrors the pattern in `global-sdk.tsx`.
   */
  private async consumeLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const attempt = new AbortController()

      // Forward the outer abort to the per-attempt controller so
      // `disconnect()` cancels the current fetch immediately.
      const onAbort = () => attempt.abort()
      signal.addEventListener("abort", onAbort)

      this.attemptController = attempt

      try {
        console.log("[Kilo New] SSE: 🎬 Calling SDK global.event()...")
        const events = await this.client.global.event({
          signal: attempt.signal,
          // Disable SDK-internal retries — consumeLoop handles reconnection
          // with its own outer while-loop. Without this the SDK's infinite
          // retry loop with exponential backoff runs in parallel, causing
          // duplicate connections and "error" state flicker.
          sseMaxRetryAttempts: 1,
          onSseError: (error) => {
            if (signal.aborted) {
              return
            }
            // Filter AbortErrors — they are expected during heartbeat timeout
            // or manual reconnect() calls, not real connection failures.
            if (error instanceof DOMException && error.name === "AbortError") {
              return
            }
            console.error("[Kilo New] SSE: ❌ SDK SSE error callback:", error)
            this.notifyError(error instanceof Error ? error : new Error(String(error)))
          },
        })

        console.log("[Kilo New] SSE: ✅ Stream opened successfully")
        this.notifyState("connected")
        this.resetHeartbeat(attempt)

        for await (const event of events.stream) {
          if (signal.aborted) {
            break
          }

          this.resetHeartbeat(attempt)

          // The SDK yields GlobalEvent = { directory, payload: Event }.
          const globalEvent = event as GlobalEvent
          const type = (globalEvent.payload as { type: string }).type
          if (type !== "server.heartbeat") {
            console.log("[Kilo New] SSE: 📨 Event:", type)
          }
          this.notifyEvent(globalEvent.payload as Event)
        }

        console.log("[Kilo New] SSE: 📭 Stream ended normally")
      } catch (error) {
        // Suppress AbortErrors — they are expected when the heartbeat timer
        // or reconnect() aborts the per-attempt controller.
        const aborted = signal.aborted || (error instanceof DOMException && error.name === "AbortError")
        if (!aborted) {
          console.error("[Kilo New] SSE: ❌ Stream error:", error)
          this.notifyError(error instanceof Error ? error : new Error(String(error)))
        }
      } finally {
        signal.removeEventListener("abort", onAbort)
        this.attemptController = null
        this.clearHeartbeat()
      }

      if (signal.aborted) {
        break
      }

      console.log(`[Kilo New] SSE: 🔄 Reconnecting in ${SdkSSEAdapter.RECONNECT_DELAY_MS}ms...`)
      this.notifyState("connecting")
      await new Promise((resolve) => setTimeout(resolve, SdkSSEAdapter.RECONNECT_DELAY_MS))
    }

    this.notifyState("disconnected")
  }

  /**
   * Reset the heartbeat timer. If no event arrives within the timeout
   * window the per-attempt controller is aborted, causing the
   * `for await` loop to exit and the outer loop to reconnect.
   */
  private resetHeartbeat(attempt: AbortController): void {
    this.clearHeartbeat()
    this.heartbeatTimer = setTimeout(() => {
      console.log("[Kilo New] SSE: ⏰ Heartbeat timeout — aborting stale connection")
      attempt.abort()
    }, SdkSSEAdapter.HEARTBEAT_TIMEOUT_MS)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ── Notify helpers ─────────────────────────────────────────────────

  private notifyEvent(event: Event): void {
    for (const handler of this.handlers) {
      try {
        handler(event)
      } catch (error) {
        console.error("[Kilo New] SSE: Error in event handler:", error)
      }
    }
  }

  private notifyError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error)
      } catch (err) {
        console.error("[Kilo New] SSE: Error in error handler:", err)
      }
    }
  }

  private notifyState(state: "connecting" | "connected" | "disconnected"): void {
    for (const handler of this.stateHandlers) {
      try {
        handler(state)
      } catch (error) {
        console.error("[Kilo New] SSE: Error in state handler:", error)
      }
    }
  }
}
