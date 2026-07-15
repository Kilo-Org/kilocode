import { RemoteProtocol } from "@/kilo-sessions/remote-protocol"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

export namespace RemoteWS {
  export type SessionInfo = RemoteProtocol.SessionInfo

  export type Options = {
    url: string
    getToken: () => Promise<string | undefined>
    getSessions: () => Promise<{ sessions: SessionInfo[] }>
    log: {
      info: (...args: any[]) => void
      error: (...args: any[]) => void
      warn: (...args: any[]) => void
    }
    onMessage?: (msg: RemoteProtocol.Inbound) => void
    onOpen?: () => void
    onDisconnect?: () => void
    heartbeat?: number
    /** Wraps callbacks that need to run in a specific async context (e.g. Instance.provide) */
    withContext?: <R>(fn: () => R) => Promise<R> | R
    /** Called when the server permanently closes the connection (e.g. auth failure, conflict) */
    onClose?: (code: number, reason: string) => void
    /** Inactivity timeout in ms — force-close if no inbound message within this window */
    timeout?: number
  }

  export type Connection = {
    readonly connectionId: string
    send(msg: RemoteProtocol.Outbound): void
    heartbeat(): Promise<void>
    /**
     * Send a heartbeat with a sequence number and resolve only after the relay
     * echoes a matching `heartbeat_ack`. Rejects on disconnect, replacement,
     * or timeout. Use this for create-session announcement and any state the
     * caller needs to know was durably observed by the relay; use the
     * fire-and-forget `heartbeat()` for liveness.
     */
    heartbeatAcknowledged(): Promise<void>
    close(): void
    readonly connected: boolean
  }

  type Timer = ReturnType<typeof setTimeout>

  // Shorter than the relay's stale-heartbeat threshold (30s) so a hung
  // acknowledged heartbeat rejects before the relay evicts the connection.
  const ACK_TIMEOUT_MS = 10_000

  export function connect(options: Options): Connection {
    const interval = options.heartbeat ?? 10_000
    const connectionId = crypto.randomUUID()
    const withContext = options.withContext ?? ((fn) => fn())
    let ws: WebSocket | undefined
    let backoff = 1000
    let timer: Timer | undefined
    let beat: Timer | undefined
    let closed = false
    const buffer: string[] = []
    let beating: Promise<void> | undefined
    let queued = false
    // Per-process monotonic sequence for acknowledged heartbeats. Starts at 0
    // and only increments on acknowledged sends, so the first call uses 1.
    let sequence = 0
    // Outstanding acknowledged heartbeats waiting for a matching ack from the
    // relay. Keyed by sequence. Rejected on disconnect, replacement, or timeout.
    const pendingAcks = new Map<
      number,
      { resolve: () => void; reject: (err: Error) => void; timer: Timer }
    >()

    function heartbeat(): Promise<void> {
      queued = true
      if (beating) return beating

      const current = Promise.resolve(
        withContext(async () => {
          while (queued) {
            if (closed) return
            queued = false
            const sessions = await options.getSessions()
            if (closed) return
            send({ type: "heartbeat", protocolVersion: InstallationVersion, ...sessions })
          }
        }),
      ).finally(() => {
        beating = undefined
        if (!queued || closed) return
        void heartbeat().catch((err) => {
          options.log.error("remote-ws heartbeat failed", { error: String(err) })
        })
      })
      beating = current
      return current
    }

    function startHeartbeat() {
      stopHeartbeat()
      beat = setInterval(() => {
        void heartbeat().catch((err) => {
          options.log.error("remote-ws heartbeat failed", { error: String(err) })
        })
      }, interval)
    }

    function stopHeartbeat() {
      if (beat) clearInterval(beat)
      beat = undefined
    }

    let activity = Date.now()
    let watchdog: Timer | undefined
    const timeout = options.timeout ?? 30_000

    function startWatchdog() {
      stopWatchdog()
      watchdog = setInterval(
        () => {
          if (Date.now() - activity > timeout) {
            options.log.warn("remote-ws activity timeout, forcing reconnect")
            stopWatchdog()
            ws?.close(4000, "activity timeout")
          }
        },
        Math.min(interval, timeout),
      )
    }

    function stopWatchdog() {
      if (watchdog) clearInterval(watchdog)
      watchdog = undefined
    }

    async function open() {
      if (closed) return
      const token = await options.getToken()
      if (closed) return
      if (!token) {
        options.log.warn("remote-ws no token, will retry")
        schedule()
        return
      }
      const endpoint = `${options.url}/api/user/cli?token=${encodeURIComponent(token)}&connectionId=${connectionId}`
      options.log.info("remote-ws connecting", { connectionId, endpoint: endpoint.replace(/token=[^&]+/, "token=***") })
      const socket = new WebSocket(endpoint)
      ws = socket

      socket.onopen = () => {
        if (ws !== socket || closed) {
          socket.close()
          return
        }
        options.log.info("remote-ws connected", { buffered: buffer.length })
        void withContext(() => options.onOpen?.())
        backoff = 1000
        for (const msg of buffer) socket.send(msg)
        buffer.length = 0
        activity = Date.now()
        startHeartbeat()
        startWatchdog()
      }

      socket.onmessage = (event) => {
        if (ws !== socket || closed) return
        activity = Date.now()
        const raw = String(event.data)
        let json: unknown
        try {
          json = JSON.parse(raw)
        } catch {
          options.log.warn("remote-ws invalid JSON", { bytes: raw.length })
          return
        }
        const preview = RemoteProtocol.Preview.safeParse(json)
        options.log.info("remote-ws received", { bytes: raw.length, ...preview.data })
        const parsed = RemoteProtocol.Inbound.safeParse(json)
        if (!parsed.success) {
          options.log.warn("remote-ws message parse failed", { error: parsed.error })
          return
        }
        // Resolve any pending acknowledged heartbeat whose sequence matches
        // the relay's echo. An unsequenced ack (legacy fire-and-forget) does
        // not satisfy an outstanding acknowledged send.
        if (parsed.data.type === "heartbeat_ack" && typeof parsed.data.sequence === "number") {
          const pending = pendingAcks.get(parsed.data.sequence)
          if (pending) {
            clearTimeout(pending.timer)
            pendingAcks.delete(parsed.data.sequence)
            pending.resolve()
          }
        }
        options.onMessage?.(parsed.data)
      }

      socket.onclose = (event) => {
        if (ws !== socket) return
        options.log.info("remote-ws closed", { code: event.code, reason: event.reason })
        ws = undefined
        stopHeartbeat()
        stopWatchdog()
        // Any outstanding acknowledged heartbeat is stranded — the relay
        // will not echo an ack on a different socket instance.
        rejectAllPendingAcks(new Error("remote connection closed before ack"))
        if (closed) return
        if (event.code === 4401 || event.code === 4403 || event.code === 4409) {
          options.log.warn("remote-ws closed permanently", {
            code: event.code,
            reason: event.reason,
          })
          void withContext(() => options.onClose?.(event.code, event.reason))
          return
        }
        void withContext(() => options.onDisconnect?.())
        schedule()
      }

      socket.onerror = (event) => {
        if (ws !== socket || closed) return
        options.log.error("remote-ws error", { error: event })
      }
    }

    function schedule() {
      if (closed) return
      timer = setTimeout(() => open(), backoff)
      backoff = Math.min(backoff * 2, 60000)
    }

    function send(msg: RemoteProtocol.Outbound) {
      const raw = JSON.stringify(msg)
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(raw)
        return
      }
      buffer.push(raw)
      if (buffer.length > 200) buffer.shift()
    }

    function close() {
      closed = true
      queued = false
      stopHeartbeat()
      stopWatchdog()
      if (timer) clearTimeout(timer)
      rejectAllPendingAcks(new Error("remote connection closed"))
      if (ws) ws.close()
    }

    function rejectAllPendingAcks(err: Error): void {
      for (const [seq, pending] of pendingAcks) {
        clearTimeout(pending.timer)
        pendingAcks.delete(seq)
        pending.reject(err)
      }
    }

    function heartbeatAcknowledged(): Promise<void> {
      const seq = ++sequence
      return new Promise((resolve, reject) => {
        if (closed) {
          reject(new Error("remote connection closed"))
          return
        }
        const timer = setTimeout(() => {
          pendingAcks.delete(seq)
          reject(new Error(`heartbeat ack timeout (sequence=${seq})`))
        }, ACK_TIMEOUT_MS)
        pendingAcks.set(seq, { resolve, reject, timer })
        // Snapshot the current sessions and send a sequenced heartbeat.
        // The relay echoes the sequence on its ack; the onmessage handler
        // resolves this promise when the match arrives.
        void withContext(async () => {
          try {
            const sessions = await options.getSessions()
            if (closed) {
              const pending = pendingAcks.get(seq)
              if (pending) {
                clearTimeout(pending.timer)
                pendingAcks.delete(seq)
                pending.reject(new Error("remote connection closed"))
              }
              return
            }
            send({ type: "heartbeat", protocolVersion: InstallationVersion, sequence: seq, ...sessions })
          } catch (err) {
            const pending = pendingAcks.get(seq)
            if (pending) {
              clearTimeout(pending.timer)
              pendingAcks.delete(seq)
              pending.reject(err instanceof Error ? err : new Error(String(err)))
            }
          }
        })
      })
    }

    void open()

    return {
      get connectionId() {
        return connectionId
      },
      send,
      heartbeat,
      heartbeatAcknowledged,
      close,
      get connected() {
        return ws?.readyState === WebSocket.OPEN
      },
    }
  }
}
