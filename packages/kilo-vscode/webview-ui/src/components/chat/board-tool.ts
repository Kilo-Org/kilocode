import type { UiI18n } from "@kilocode/kilo-ui/context/i18n"
import type { SessionInfo } from "../../types/messages"

type Message = {
  body: string
  from?: string
  to?: string
  type?: string
}

type Board = {
  messages: Message[]
  names: Map<string, string>
  more: boolean
  valid: boolean
  warning?: string
  recipients?: "active" | "inactive" | "unknown"
  raw?: string
}

const cache = new WeakMap<Record<string, unknown>, { tool: string; output: string; data: Board }>()

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function message(value: unknown): Message | undefined {
  if (!object(value) || typeof value.body !== "string") return
  return { body: value.body, from: text(value.from), to: text(value.to), type: text(value.type) }
}

export function board(tool: string, input: Record<string, unknown>, output?: string): Board {
  if (!output) {
    const pending = tool === "board_post" ? message(input) : undefined
    return { messages: pending ? [pending] : [], names: new Map(), more: false, valid: false }
  }
  const cached = cache.get(input)
  if (cached?.tool === tool && cached.output === output) return cached.data
  const data = parse(tool, output)
  cache.set(input, { tool, output, data })
  return data
}

function parse(tool: string, output: string): Board {
  const names = new Map<string, string>()
  const fallback: Board = { messages: [], names, more: false, valid: false, raw: output }
  const value: unknown = (() => {
    try {
      return JSON.parse(output)
    } catch {
      return undefined
    }
  })()
  if (!object(value)) return fallback
  const rows = tool === "board_post" ? [value] : Array.isArray(value.messages) ? value.messages : undefined
  if (!rows) return fallback
  const messages = rows.map(message)
  if (messages.some((item) => !item)) return fallback
  if (Array.isArray(value.participants)) {
    for (const item of value.participants) {
      if (object(item) && typeof item.id === "string" && typeof item.label === "string") {
        const name = item.id === "main" ? "main" : text(item.description)?.trim() || item.label
        names.set(item.id, name)
        const id = text(item.sessionID)
        if (id) names.set(id, name)
      }
    }
  }
  const state = object(value.recipients) ? value.recipients.state : undefined
  return {
    messages: messages as Message[],
    names,
    more: value.hasMore === true,
    valid: true,
    warning: text(value.warning),
    recipients: state === "active" || state === "inactive" || state === "unknown" ? state : undefined,
  }
}

export function recipient(
  id: string,
  names: Map<string, string>,
  labels: { main: string; all: string; agent: (id: string) => string },
  cached?: string,
) {
  if (id === "main" || names.get(id) === "main") return labels.main
  if (id === "ALL") return labels.all
  const name = cached || names.get(id)
  if (name) return name.replace(/ \(@[^()]+ subagent\)$/, "")
  if (!id.startsWith("ses_")) return id
  const suffix = id.slice(4)
  return labels.agent(suffix.length > 8 ? `${suffix.slice(0, 4)}…${suffix.slice(-4)}` : suffix)
}

export function presentation(
  tool: string,
  data: ReturnType<typeof board>,
  completed: boolean,
  t: UiI18n["t"],
  lookup?: (id: string) => Pick<SessionInfo, "title" | "parentID"> | undefined,
) {
  const post = tool === "board_post"
  const inactive =
    post &&
    (data.recipients
      ? data.recipients === "inactive"
      : data.warning === "Stored only; resume the task to request work.")
  const name = (id: string) => {
    const info = lookup?.(id)
    const cached = info?.title ? (info.parentID ? info.title : t("tool.board.main")) : undefined
    return recipient(
      id,
      data.names,
      {
        main: t("tool.board.main"),
        all: t("tool.board.all"),
        agent: (id) => t("tool.board.agent", { id }),
      },
      cached,
    )
  }
  const status = (() => {
    if (!completed || !post) return
    if (data.recipients === "inactive") return t("tool.board.audience")
    if (data.recipients === "unknown") return t("tool.board.unknown")
    if (data.recipients === "active") return
    if (inactive) return t("tool.board.inactive")
    if (data.warning) return t("tool.board.status", { status: data.warning })
  })()
  const title = (() => {
    if (!completed || !data.valid) return t(post ? "tool.board.post" : "tool.board.read")
    if (!post) {
      return t(data.messages.length === 1 ? "tool.board.message" : "tool.board.messages", {
        count: data.messages.length,
      })
    }
    const to = data.messages.at(0)?.to
    return to ? t(inactive ? "tool.board.saved" : "tool.board.posted", { recipient: name(to) }) : t("tool.board.post")
  })()
  return {
    title,
    subtitle: completed ? t("tool.board.channel") : undefined,
    messages: data.messages,
    from: (id: string) => t("tool.board.from", { sender: name(id) }),
    to: (id: string) => t("tool.board.to", { recipient: name(id) }),
    unavailable: completed && !data.valid ? t("tool.board.unavailable") : undefined,
    empty: completed && data.valid && !data.messages.length ? t("tool.board.empty") : undefined,
    status,
    receipt: completed && post && data.valid && data.messages.length ? t("tool.board.receipt") : undefined,
    more: data.more ? t("tool.board.more") : undefined,
  }
}

export function transcript(view: ReturnType<typeof presentation>) {
  return [
    view.title,
    view.subtitle,
    ...view.messages.flatMap((item) => [
      item.from ? view.from(item.from) : undefined,
      item.to ? view.to(item.to) : undefined,
      item.body,
    ]),
    view.unavailable,
    view.empty,
    view.status,
    view.receipt,
    view.more,
  ].filter((text): text is string => typeof text === "string")
}
