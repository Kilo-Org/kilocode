import { RemoteProtocol } from "@/kilo-sessions/remote-protocol"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

export namespace RemoteWS {
  export type SessionInfo = RemoteProtocol.SessionInfo

  export type Timers = {
    setTimeout: (fn: () => void, ms?: number) => unknown
    clearTimeout: (t: unknown) => void
    setInterval: (fn: () => void, ms?: number) => unknown
    clearInterval: (t: unknown) => void
  }

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
    /** Injectable timer primitives for deterministic testing. Defaults to globals. */
    timers?: Timers
    /** Injectable clock for deterministic testing. Defaults to Date.now. */
    now?: () => number
    /** Token-acquisition deadline in ms. Defaults to 15_000. */
    tokenTimeout?: number
    /** Connection-attempt deadline (token acquisition through onopen) in ms. Defaults to 30_000. */
    connectTimeout?: number
  }

  export type Connection = {
    readonly connectionId: string
    send(msg: RemoteProtocol.Outbound): void
    heartbeat(): Promise<void>
    close(): void
    readonly connected: boolean
  }

  const defaultTimers: Timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (t) => clearInterval(t as ReturnType<typeof setInterval>),
  }

  type Gen = { id: number; settled: boolean }

  export function connect(options: Options): Connection {
    const interval = options.heartbeat ?? 10_000
    const connectionId = crypto.randomUUID()
    const withContext = options.withContext ?? ((fn) => fn())
    const timers = options.timers ?? defaultTimers
    const now = options.now ?? Date.now
    const tokenTimeout = options.tokenTimeout ?? 15_000
    const connectTimeout = options.connectTimeout ?? 30_000
    let ws: WebSocket | undefined
    let backoff = 1000
    let timer: unknown
    let beat: unknown
    let closed = false
    const buffer: string[] = []
    let beating: Promise<void> | undefined
    let queued = false

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
      beat = timers.setInterval(() => {
        void heartbeat().catch((err) => {
          options.log.error("remote-ws heartbeat failed", { error: String(err) })
        })
      }, interval)
    }

    function stopHeartbeat() {
      if (beat) timers.clearInterval(beat)
      beat = undefined
    }

    let activity = now()
    let watchdog: unknown
    const timeout = options.timeout ?? 30_000

    function startWatchdog() {
      stopWatchdog()
      watchdog = timers.setInterval(
        () => {
          if (now() - activity > timeout) {
            options.log.warn("remote-ws activity timeout, forcing reconnect")
            stopWatchdog()
            ws?.close(4000, "activity timeout")
          }
        },
        Math.min(interval, timeout),
      )
    }

    function stopWatchdog() {
      if (watchdog) timers.clearInterval(watchdog)
      watchdog = undefined
    }

    // Connect-attempt deadline (covers token acquisition through onopen).
    let connectDeadline: unknown
    let currentGen = 0

    function startConnectDeadline(g: Gen) {
      stopConnectDeadline()
      connectDeadline = timers.setTimeout(() => {
        connectDeadline = undefined
        if (closed || g.settled) return
        options.log.warn("remote-ws connect attempt deadline, will retry", { gen: g.id })
        if (ws) ws.close(4001, "connect timeout")
        scheduleRetry(g)
      }, connectTimeout)
    }

    function stopConnectDeadline() {
      if (connectDeadline) timers.clearTimeout(connectDeadline)
      connectDeadline = undefined
    }

    // Single fenced retry owner: exactly one of {token-failure, connect-deadline,
    // onclose, sync-throw} may schedule a retry for a given generation.
    function scheduleRetry(g: Gen) {
      if (closed || g.settled) return
      g.settled = true
      schedule()
    }

    function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let done = false
        const t = timers.setTimeout(() => {
          if (done) return
          done = true
          reject(new Error(label))
        }, ms)
        promise.then(
          (v) => {
            if (done) return
            done = true
            timers.clearTimeout(t)
            resolve(v)
          },
          (err) => {
            if (done) return
            done = true
            timers.clearTimeout(t)
            reject(err)
          },
        )
      })
    }

    async function open() {
      if (closed) return
      const g: Gen = { id: ++currentGen, settled: false }
      startConnectDeadline(g)
      try {
        let token: string | undefined
        try {
          token = await withTimeout(options.getToken(), tokenTimeout, "remote-ws token timeout")
        } catch (err) {
          if (closed) return
          options.log.warn("remote-ws getToken failed, will retry", { gen: g.id, error: String(err) })
          scheduleRetry(g)
          return
        }
        if (closed) return
        if (!token) {
          options.log.warn("remote-ws no token, will retry", { gen: g.id })
          scheduleRetry(g)
          return
        }
        const endpoint = `${options.url}/api/user/cli?token=${encodeURIComponent(token)}&connectionId=${connectionId}`
        options.log.info("remote-ws connecting", { connectionId, gen: g.id, endpoint: endpoint.replace(/token=[^&]+/, "token=***") })
        let socket: WebSocket
        try {
          socket = new WebSocket(endpoint)
        } catch (err) {
          if (closed) return
          options.log.warn("remote-ws constructor threw, will retry", { gen: g.id, error: String(err) })
          scheduleRetry(g)
          return
        }
        ws = socket

        socket.onopen = () => {
          if (g.settled || ws !== socket || closed) {
            socket.close()
            return
          }
          stopConnectDeadline()
          options.log.info("remote-ws connected", { gen: g.id, buffered: buffer.length })
          void withContext(() => options.onOpen?.())
          backoff = 1000
          for (const msg of buffer) socket.send(msg)
          buffer.length = 0
          activity = now()
          startHeartbeat()
          startWatchdog()
        }

        socket.onmessage = (event) => {
          if (g.settled || ws !== socket || closed) return
          activity = now()
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

        socket.onclose = (event) => {
          if (ws !== socket) return
          stopConnectDeadline()
          options.log.info("remote-ws closed", { code: event.code, reason: event.reason, gen: g.id })
          ws = undefined
          stopHeartbeat()
          stopWatchdog()
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
          scheduleRetry(g)
        }

        socket.onerror = (event) => {
          if (g.settled || ws !== socket || closed) return
          options.log.error("remote-ws error", { error: event })
        }
      } catch (err) {
        if (closed) return
        options.log.warn("remote-ws open threw, will retry", { gen: g.id, error: String(err) })
        scheduleRetry(g)
      }
    }

    function schedule() {
      if (closed) return
      timer = timers.setTimeout(() => open(), backoff)
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
      stopConnectDeadline()
      if (timer) timers.clearTimeout(timer)
      if (ws) ws.close()
    }

    void open()

    return {
      get connectionId() {
        return connectionId
      },
      send,
      heartbeat,
      close,
      get connected() {
        return ws?.readyState === WebSocket.OPEN
      },
    }
  }
}
