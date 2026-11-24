import { dict } from "@kilocode/kilo-i18n/en"
import { Plugin } from "@opencode/plugin/tui"
import net from "node:net"

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
const TICK = 1_000
const SOCKET_TIMEOUT = 500
const PLAIN_COMMAND = /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/
const FORBIDDEN_ARG_CHARS = /['\u0000-\u001F\u007F-\u009F]/
const MAX_RESUME_ARGV_BYTES = 8_192

export type HerdrTranslationKey = keyof typeof dict
export type HerdrDictionary = Record<string, string>
export type HerdrTranslator = (key: HerdrTranslationKey) => string
// Locale dictionaries load lazily because the TUI's active locale is only known at runtime.
const herdrDictionaryLoaders: Record<string, () => Promise<{ dict: HerdrDictionary }>> = {
  ar: () => import("@kilocode/kilo-i18n/ar"),
  br: () => import("@kilocode/kilo-i18n/br"),
  bs: () => import("@kilocode/kilo-i18n/bs"),
  da: () => import("@kilocode/kilo-i18n/da"),
  de: () => import("@kilocode/kilo-i18n/de"),
  es: () => import("@kilocode/kilo-i18n/es"),
  fr: () => import("@kilocode/kilo-i18n/fr"),
  it: () => import("@kilocode/kilo-i18n/it"),
  ja: () => import("@kilocode/kilo-i18n/ja"),
  ko: () => import("@kilocode/kilo-i18n/ko"),
  nl: () => import("@kilocode/kilo-i18n/nl"),
  no: () => import("@kilocode/kilo-i18n/no"),
  pl: () => import("@kilocode/kilo-i18n/pl"),
  ru: () => import("@kilocode/kilo-i18n/ru"),
  th: () => import("@kilocode/kilo-i18n/th"),
  tr: () => import("@kilocode/kilo-i18n/tr"),
  uk: () => import("@kilocode/kilo-i18n/uk"),
  zh: () => import("@kilocode/kilo-i18n/zh"),
  zht: () => import("@kilocode/kilo-i18n/zht"),
}

export function t(dictionary: HerdrDictionary, key: HerdrTranslationKey) {
  return dictionary[key] ?? dict[key]
}
const defaultHerdrTranslator: HerdrTranslator = (key) => t(dict, key)

export async function loadHerdrTranslator(locale = Intl.DateTimeFormat().resolvedOptions().locale): Promise<HerdrTranslator> {
  const normalized = locale.toLowerCase().replaceAll("_", "-")
  const language = normalized.startsWith("pt-br")
    ? "br"
    : normalized.startsWith("zh-tw") ||
        normalized.startsWith("zh-hk") ||
        normalized.startsWith("zh-mo") ||
        normalized.startsWith("zh-hant")
      ? "zht"
      : normalized.split("-")[0]
  const dictionary = (await herdrDictionaryLoaders[language]?.())?.dict ?? dict
  return (key) => t(dictionary, key)
}

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

export function status(
  data: Plugin.Context["data"],
  sessionID: string | undefined,
  translate: HerdrTranslator = defaultHerdrTranslator,
): HerdrReport {
  if (!sessionID) return { state: "idle" }
  const root = data.session.root(sessionID)
  const members = Array.from(new Set([root, ...data.session.family(root)]))
  if (members.some((id) => (data.session.permission.list(id)?.length ?? 0) > 0)) {
    return { state: "blocked", sessionID: root, message: translate("tui.herdr.permissionNeedsInput") }
  }
  if (members.some((id) => (data.session.form.list(id)?.length ?? 0) > 0)) {
    return { state: "blocked", sessionID: root, message: translate("tui.herdr.inputNeedsResponse") }
  }
  const working = members.some(
    (id) =>
      data.session.status(id) === "running" ||
      data.session.pending.list(id).some((item) => item.type !== "synthetic"),
  )
  if (working) return { state: "working", sessionID: root }
  return { state: "idle", sessionID: root }
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
  translate?: HerdrTranslator
}) {
  let seq = (input.now?.() ?? Date.now()) * 1000
  let delivered: string | undefined
  let inflight: string | undefined

  // A state counts as reported only after Herdr answers; a failed send is retried on the next tick.
  const tick = () => {
    const report = status(input.data, input.session(), input.translate)
    const key = JSON.stringify(report)
    if (key === delivered || key === inflight) return
    inflight = key
    seq += 1
    void input.send("pane.report_agent", seq, report).then((ok) => {
      if (inflight !== key) return
      inflight = undefined
      if (ok) delivered = key
    })
  }

  const stop = () => {
    delivered = undefined
    inflight = undefined
    seq += 1
    return input.send("pane.release_agent", seq)
  }

  return { tick, stop }
}

// Resolves true once Herdr replies; connection errors, early close, and timeouts resolve false.
export function sendSocketRequest(socketPath: string, payload: string, timeoutMs = SOCKET_TIMEOUT): Promise<boolean> {
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath
  return new Promise((resolve) => {
    let settled = false
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
    client.on("data", () => finish(true))
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
  async setup(context) {
    if (process.env.HERDR_ENV !== "1") return
    const paneID = process.env.HERDR_PANE_ID
    const socketPath = process.env.HERDR_SOCKET_PATH
    if (!paneID || !socketPath) return

    const send = createSender({
      paneID,
      transport: (payload) => sendSocketRequest(socketPath, payload),
    })

    const translate = await loadHerdrTranslator()
    const reporter = createReporter({
      data: context.data,
      session: () => {
        const route = context.ui.router.current()
        return route.type === "session" && route.sessionID !== "dummy" ? route.sessionID : undefined
      },
      send,
      translate,
    })
    const timer = setInterval(reporter.tick, TICK)
    timer.unref()
    reporter.tick()

    return async () => {
      clearInterval(timer)
      await reporter.stop()
    }
  },
})
