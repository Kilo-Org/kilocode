import { dict } from "@kilocode/kilo-i18n/en"
import { Plugin } from "@opencode/plugin/tui"
import { Option, Schema } from "effect"
import net from "node:net"
import { createEffect, createRoot } from "solid-js"
import { sessionActivity } from "./session-activity"

declare const OPENCODE_CLI_NAME: string | undefined

export type HerdrState = "idle" | "working" | "blocked"

export interface HerdrReport {
  state: HerdrState
  sessionID?: string
  message?: string
}

export type HerdrMethod = "pane.report_agent" | "pane.release_agent"

const SOURCE = "kilo"
const AGENT = "kilo"
const RETRY = 1_000
const SOCKET_TIMEOUT = 500
const PLAIN_COMMAND = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/
const FORBIDDEN_ARG_CHARS = /['\u0000-\u001F\u007F-\u009F]/
const MAX_RESUME_ARGV_BYTES = 8_192

export function defaultCliName() {
  return typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : AGENT
}

// Herdr validates resume_argv strictly and rejects the entire pane.report_agent on invalid values.
export function buildResumeArgv(sessionID: string | undefined, command = defaultCliName()) {
  if (!sessionID) return undefined
  if (!PLAIN_COMMAND.test(command)) return undefined
  if (FORBIDDEN_ARG_CHARS.test(sessionID)) return undefined
  const argv = [command, "--session", sessionID]
  if (Buffer.byteLength(argv.join(""), "utf8") > MAX_RESUME_ARGV_BYTES) return undefined
  return argv
}

export function status(data: Plugin.Context["data"], sessionID: string | undefined): HerdrReport {
  if (!sessionID) return { state: "idle" }
  const family = sessionActivity(data, sessionID)
  if (family.attention === "permission")
    return { state: "blocked", sessionID: family.root, message: dict["tui.herdr.waitingForPermission"] }
  if (family.attention === "question")
    return { state: "blocked", sessionID: family.root, message: dict["tui.herdr.waitingForAnswer"] }
  if (family.busy) return { state: "working", sessionID: family.root }
  return { state: "idle", sessionID: family.root }
}

export function buildRequest(input: {
  method: HerdrMethod
  paneID: string
  seq: number
  report?: HerdrReport
  command?: string
}) {
  const resumeArgv =
    input.method === "pane.report_agent" ? buildResumeArgv(input.report?.sessionID, input.command) : undefined
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
      ...(resumeArgv ? { resume_argv: resumeArgv } : {}),
      ...(input.report?.message ? { message: input.report.message } : {}),
    },
  }
}

export function createReporter(input: {
  data: Plugin.Context["data"]
  session: () => string | undefined
  send: (method: HerdrMethod, seq: number, report?: HerdrReport) => Promise<boolean>
  now?: () => number
  retryMs?: number
}) {
  let seq = (input.now?.() ?? Date.now()) * 1000
  let delivered: string | undefined
  let inflight: string | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  // A state counts as reported only after Herdr answers. Callers tick when the state changes, so a failed send
  // schedules its own retry instead of waiting for a transition that may never come.
  const tick = () => {
    if (stopped) return
    const report = status(input.data, input.session())
    const key = JSON.stringify(report)
    if (key === delivered || key === inflight) return
    clearTimeout(retry)
    inflight = key
    seq += 1
    void input.send("pane.report_agent", seq, report).then((ok) => {
      if (stopped || inflight !== key) return
      inflight = undefined
      if (ok) {
        delivered = key
        return
      }
      retry = setTimeout(tick, input.retryMs ?? RETRY)
      retry.unref?.()
    })
  }

  const stop = () => {
    stopped = true
    clearTimeout(retry)
    delivered = undefined
    inflight = undefined
    seq += 1
    return input.send("pane.release_agent", seq)
  }

  return { tick, stop }
}

const decodeReply = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      error: Schema.optional(
        Schema.Struct({ code: Schema.optional(Schema.String), message: Schema.optional(Schema.String) }),
      ),
    }),
  ),
)

/** Why Herdr did not apply a request, or undefined when the reply line is a success. */
export function replyRejection(line: string) {
  const reply = decodeReply(line)
  if (Option.isNone(reply)) return "malformed reply"
  const error = reply.value.error
  if (!error) return undefined
  return [error.code, error.message].filter(Boolean).join(": ") || "rejected"
}

// sun_path holds 104 bytes on macOS and the BSDs and 108 on Linux, terminator included. Windows uses a named pipe.
export function socketPathTooLong(socketPath: string, platform: string = process.platform) {
  if (platform === "win32") return false
  return Buffer.byteLength(socketPath, "utf8") >= (platform === "linux" ? 108 : 104)
}

// Resolves true once Herdr replies; connection errors, early close, and timeouts resolve false. A reply that rejects
// the request still resolves true, because resending the same payload would be rejected again; onRejected reports it.
export function sendSocketRequest(
  socketPath: string,
  payload: string,
  timeoutMs = SOCKET_TIMEOUT,
  onRejected?: (reason: string) => void,
): Promise<boolean> {
  // Herdr passes a plain path and serves it inside the named-pipe namespace; a value already in that form is used as is.
  const endpoint =
    process.platform === "win32" && !socketPath.startsWith("\\\\.\\pipe\\") ? `\\\\.\\pipe\\${socketPath}` : socketPath
  return new Promise((resolve) => {
    let settled = false
    let reply = ""
    const client = net.createConnection(endpoint, () => {
      client.write(`${payload}\n`)
    })
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref?.()
    client.unref()
    client.setTimeout(timeoutMs, () => finish(false))
    client.on("data", (chunk) => {
      reply += chunk.toString("utf8")
      const end = reply.indexOf("\n")
      if (end < 0) return
      const reason = replyRejection(reply.slice(0, end))
      if (reason) onRejected?.(reason)
      finish(true)
    })
    client.on("error", () => finish(false))
    client.on("end", () => finish(false))
    client.on("close", () => finish(false))
  })
}

export function createSender(input: {
  paneID: string
  transport: (payload: string) => Promise<boolean>
  timeoutMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? SOCKET_TIMEOUT
  let next: { payload: string; done: PromiseWithResolvers<boolean> } | undefined
  let draining = false

  const drain = async () => {
    draining = true
    while (next) {
      const item = next
      next = undefined
      const timeout = Promise.withResolvers<boolean>()
      const timer = setTimeout(() => timeout.resolve(false), timeoutMs)
      const ok = await Promise.race([
        Promise.resolve()
          .then(() => input.transport(item.payload))
          .catch(() => false),
        timeout.promise,
      ])
      clearTimeout(timer)
      item.done.resolve(ok)
    }
    draining = false
  }

  // Each call resolves with its own delivery outcome; a request replaced before it was sent resolves false.
  return (method: HerdrMethod, seq: number, report?: HerdrReport) => {
    next?.done.resolve(false)
    next = {
      payload: JSON.stringify(buildRequest({ method, paneID: input.paneID, seq, report })),
      done: Promise.withResolvers<boolean>(),
    }
    const result = next.done.promise
    if (!draining) void drain()
    return result
  }
}

export default Plugin.define({
  id: "kilocode.herdr-agent-state",
  setup(context) {
    if (process.env.HERDR_ENV !== "1") return
    const paneID = process.env.HERDR_PANE_ID
    const socketPath = process.env.HERDR_SOCKET_PATH
    if (!paneID || !socketPath) return
    if (socketPathTooLong(socketPath)) {
      context.ui.toast.show({ variant: "error", message: dict["tui.herdr.socketPathTooLong"] })
      return
    }

    let warned = false
    const send = createSender({
      paneID,
      transport: (payload) =>
        sendSocketRequest(socketPath, payload, SOCKET_TIMEOUT, (reason) => {
          // Herdr rejects for stable reasons (unknown pane, invalid resume command), so one line is enough.
          if (warned) return
          warned = true
          console.warn("Herdr rejected an agent state report", reason)
        }),
    })

    const reporter = createReporter({
      data: context.data,
      session: () => {
        const route = context.ui.router.current()
        return route.type === "session" && route.sessionID !== "dummy" ? route.sessionID : undefined
      },
      send,
    })
    // The data store and the route are reactive, so a state change reports immediately instead of on a poll.
    let dispose = () => {}
    createRoot((stop) => {
      dispose = stop
      createEffect(() => reporter.tick())
    })

    return async () => {
      dispose()
      await reporter.stop()
    }
  },
})
