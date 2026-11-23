import net from "node:net"
import { Plugin } from "@opencode/plugin/tui"

export type HerdrState = "idle" | "working" | "blocked"

export interface HerdrReport {
  state: HerdrState
  sessionID?: string
  message?: string
}

export type HerdrMethod = "pane.report_agent" | "pane.release_agent"

const SOURCE = "kilo2"
const AGENT = "kilo2"
const TICK = 1_000
const SOCKET_TIMEOUT = 500

export function status(data: Plugin.Context["data"], sessionID: string | undefined): HerdrReport {
  if (!sessionID) return { state: "idle" }
  const root = data.session.root(sessionID)
  const members = Array.from(new Set([root, ...data.session.family(root)]))
  if (members.some((id) => (data.session.permission.list(id)?.length ?? 0) > 0)) {
    return { state: "blocked", sessionID: root, message: "Permission needs input" }
  }
  if (members.some((id) => (data.session.form.list(id)?.length ?? 0) > 0)) {
    return { state: "blocked", sessionID: root, message: "Input needs response" }
  }
  const working = members.some(
    (id) =>
      data.session.status(id) === "running" ||
      data.session.pending.list(id).some((item) => item.type !== "synthetic"),
  )
  if (working) return { state: "working", sessionID: root }
  return { state: "idle", sessionID: root }
}

export function buildRequest(input: { method: HerdrMethod; paneID: string; seq: number; report?: HerdrReport }) {
  return {
    id: `${SOURCE}:${input.seq}`,
    method: input.method,
    params: {
      pane_id: input.paneID,
      source: SOURCE,
      agent: AGENT,
      seq: input.seq,
      ...(input.report ? { state: input.report.state } : {}),
      ...(input.report?.sessionID ? { agent_session_id: input.report.sessionID } : {}),
      ...(input.report?.message ? { message: input.report.message } : {}),
    },
  }
}

export function createReporter(input: {
  data: Plugin.Context["data"]
  session: () => string | undefined
  send: (method: HerdrMethod, seq: number, report?: HerdrReport) => void
  now?: () => number
}) {
  let seq = (input.now?.() ?? Date.now()) * 1000
  let lastKey: string | undefined

  const tick = () => {
    const report = status(input.data, input.session())
    const key = JSON.stringify(report)
    if (key === lastKey) return
    lastKey = key
    seq += 1
    input.send("pane.report_agent", seq, report)
  }

  const stop = () => {
    lastKey = undefined
    seq += 1
    input.send("pane.release_agent", seq)
  }

  return { tick, stop }
}

export function sendSocketRequest(socketPath: string, payload: string, timeoutMs = SOCKET_TIMEOUT): Promise<void> {
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath
  return new Promise((resolve) => {
    let settled = false
    const client = net.createConnection(endpoint, () => {
      client.write(`${payload}\n`)
    })
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.destroy()
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    timer.unref?.()
    client.unref()
    client.setTimeout(timeoutMs, finish)
    client.on("data", finish)
    client.on("error", finish)
    client.on("end", finish)
    client.on("close", finish)
  })
}

export function createSender(input: {
  paneID: string
  transport: (payload: string) => Promise<void>
  timeoutMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? SOCKET_TIMEOUT
  let inFlight = false
  let pending: string | undefined

  const flush = () => {
    if (inFlight || pending === undefined) return
    const payload = pending
    pending = undefined
    inFlight = true

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
      timer.unref?.()
    })

    Promise.race([input.transport(payload).catch(() => {}), timeout]).finally(() => {
      if (timer) clearTimeout(timer)
      inFlight = false
      flush()
    })
  }

  return (method: HerdrMethod, seq: number, report?: HerdrReport) => {
    pending = JSON.stringify(buildRequest({ method, paneID: input.paneID, seq, report }))
    flush()
  }
}

export default Plugin.define({
  id: "kilocode.herdr-agent-state",
  setup(context) {
    if (process.env.HERDR_ENV !== "1") return
    const paneID = process.env.HERDR_PANE_ID
    const socketPath = process.env.HERDR_SOCKET_PATH
    if (!paneID || !socketPath) return

    const send = createSender({
      paneID,
      transport: (payload) => sendSocketRequest(socketPath, payload),
    })

    const reporter = createReporter({
      data: context.data,
      session: () => {
        const route = context.ui.router.current()
        return route.type === "session" && route.sessionID !== "dummy" ? route.sessionID : undefined
      },
      send,
    })

    const timer = setInterval(reporter.tick, TICK)
    timer.unref()
    reporter.tick()

    return () => {
      clearInterval(timer)
      reporter.stop()
    }
  },
})
