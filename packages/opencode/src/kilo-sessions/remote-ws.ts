import { RemoteProtocol } from "@/kilo-sessions/remote-protocol"

export namespace RemoteWS {
  export type SessionInfo = RemoteProtocol.SessionInfo

  export type Options = {
    url: string
    getToken: () => Promise<string | undefined>
    getSessions: () => SessionInfo[] | Promise<SessionInfo[]>
    log: {
      info: (...args: any[]) => void
      error: (...args: any[]) => void
      warn: (...args: any[]) => void
    }
    onMessage?: (msg: RemoteProtocol.Inbound) => void
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
    close(): void
    readonly connected: boolean
  }

  type Timer = ReturnType<typeof setTimeout>

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

    function startHeartbeat() {
      stopHeartbeat()
      beat = setInterval(() => {
        void withContext(async () => {
          send({ type: "heartbeat", sessions: await options.getSessions() })
        }).catch((err) => {
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
      if (!token) {
        options.log.warn("remote-ws no token, will retry")
        schedule()
        return
      }
      const endpoint = `${options.url}/api/user/cli?token=${encodeURIComponent(token)}&connectionId=${connectionId}`
      options.log.info("remote-ws connecting", { connectionId, endpoint: endpoint.replace(/token=[^&]+/, "token=***") })
      ws = new WebSocket(endpoint)

      ws.onopen = () => {
        options.log.info("remote-ws connected", { buffered: buffer.length })
        backoff = 1000
        for (const msg of buffer) ws!.send(msg)
        buffer.length = 0
        activity = Date.now()
        startHeartbeat()
        startWatchdog()
      }

      ws.onmessage = (event) => {
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
        options.onMessage?.(parsed.data)
      }

      ws.onclose = (event) => {
        options.log.info("remote-ws closed", { code: event.code, reason: event.reason })
        ws = undefined
        stopHeartbeat()
        stopWatchdog()
        if (event.code === 4401 || event.code === 4403 || event.code === 4409) {
          options.log.warn("remote-ws closed permanently", {
            code: event.code,
            reason: event.reason,
          })
          options.onClose?.(event.code, event.reason)
          return
        }
        schedule()
      }

      ws.onerror = (event) => {
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
      stopHeartbeat()
      stopWatchdog()
      if (timer) clearTimeout(timer)
      if (ws) ws.close()
    }

    open()

    return {
      connectionId,
      send,
      close,
      get connected() {
        return ws?.readyState === WebSocket.OPEN
      },
    }
  }
}
