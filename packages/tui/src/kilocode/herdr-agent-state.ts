import { dict } from "@kilocode/kilo-i18n/en"
import { Plugin } from "@opencode/plugin/tui"
import type { ConfigEntry } from "@opencode/client"
import { ConfigFlag } from "@opencode/schema/config/flag"
import net from "node:net"

export type HerdrState = "idle" | "working" | "blocked"

export interface HerdrReport {
  state: HerdrState
  sessionID?: string
  message?: string
}

export type HerdrMethod = "pane.report_agent" | "pane.release_agent"

const SOURCE = "kilo2"
const AGENT = "kilo2"
const HERDR_FLAG = "herdr_agent_state" satisfies ConfigFlag.Key
const TICK = 1_000
const SOCKET_TIMEOUT = 500

export type HerdrConfigEntries = ReadonlyArray<ConfigEntry>

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

export function herdrFlagEnabled(input: {
  entries: HerdrConfigEntries
  channel: string
  overrides?: string
}) {
  const env = new Map(
    (input.overrides ?? process.env.OPENCODE_FLAGS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item): [string, boolean] => (item.startsWith("-") ? [item.slice(1), false] : [item, true])),
  )
  const all = env.get(ConfigFlag.wildcard) === true
  const experimental = input.entries.findLast(
    (entry) => entry.type === "document" && entry.info.experimental !== undefined,
  )
  const allFlags = input.entries.findLast(
    (entry) => entry.type === "document" && entry.info.experimental?.all_flags !== undefined,
  )
  const configured = experimental?.type === "document" ? experimental.info.experimental?.[HERDR_FLAG] : undefined
  const configuredAll = allFlags?.type === "document" && allFlags.info.experimental?.all_flags === true
  return env.get(HERDR_FLAG) ?? (all ? true : undefined) ?? configured ?? (configuredAll ? true : undefined) ?? (input.channel === "local" || input.channel === "dev")
}

export function herdrActivationEnabled(input: {
  entries: HerdrConfigEntries
  channel: string
  herdrEnv?: string
  overrides?: string
}) {
  return input.herdrEnv === "1" && herdrFlagEnabled(input)
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
  translate?: HerdrTranslator
}) {
  let seq = (input.now?.() ?? Date.now()) * 1000
  let lastKey: string | undefined

  const tick = () => {
    const report = status(input.data, input.session(), input.translate)
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
  async setup(context) {
    if (process.env.HERDR_ENV !== "1") return
    const paneID = process.env.HERDR_PANE_ID
    const socketPath = process.env.HERDR_SOCKET_PATH
    if (!paneID || !socketPath) return
    const entries = await context.client.config
      .get(context.location ? { location: { directory: context.location.directory } } : undefined)
      .catch(() => undefined)
    if (!entries || !herdrActivationEnabled({ entries, channel: context.app.channel, herdrEnv: process.env.HERDR_ENV })) return

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

    return () => {
      clearInterval(timer)
      reporter.stop()
    }
  },
})
