import { KiloTitleIcon } from "./title-icon"

type Session = {
  id: string
  title: string
  parentID?: string | null
}

type Status = {
  type: "idle" | "retry" | "busy" | "offline"
}

type Message = {
  id: string
  role: string
}

type Part = {
  type: string
  tool?: string
  state?: {
    status: string
  }
}

type Queue = Record<string, readonly unknown[] | undefined>

export namespace KiloTerminalTitle {
  export type Indicator = "none" | "working" | "attention" | "finished"

  export type Data = {
    session: readonly Session[]
    session_status: Record<string, Status | undefined>
    permission: Queue
    question: Queue
    suggestion: Queue
    network: Queue
    message: Record<string, readonly Message[] | undefined>
    part: Record<string, readonly Part[] | undefined>
  }

  export type Result = {
    title: string
    id?: string
    active: boolean
    indicator: Indicator
  }

  const icons = {
    none: {
      none: "",
      working: "",
      attention: "",
      finished: "",
    },
    unicode: {
      none: "",
      working: "◔",
      attention: "⚠",
      finished: "✓",
    },
    emojis: {
      none: "",
      working: "💭",
      attention: "🔶",
      finished: "✅",
    },
  } satisfies Record<KiloTitleIcon.Value, Record<Indicator, string>>

  export function format(input: { base: string; title?: string; indicator: Indicator; icon?: KiloTitleIcon.Value }) {
    const text = input.title ? `${input.base} | ${truncate(input.title)}` : input.base
    const prefix = icons[input.icon ?? KiloTitleIcon.Default][input.indicator]
    if (!prefix) return text
    return `${prefix} ${text}`
  }

  export function session(input: {
    base: string
    id: string
    data: Data
    done: Record<string, true>
    icon?: KiloTitleIcon.Value
  }): Result {
    const info = input.data.session.find((item) => item.id === input.id)
    const id = root(input.data.session, input.id)
    const ids = family(input.data.session, id)
    const indicator = state({ data: input.data, ids, done: input.done[id] === true })

    return {
      title: format({ base: input.base, title: info?.title, indicator, icon: input.icon }),
      id,
      active: indicator === "working" || indicator === "attention",
      indicator,
    }
  }

  function truncate(title: string) {
    if (title.length <= 40) return title
    return title.slice(0, 37) + "..."
  }

  function root(list: readonly Session[], id: string) {
    return list.find((item) => item.id === id)?.parentID ?? id
  }

  function family(list: readonly Session[], id: string) {
    return list.filter((item) => item.id === id || item.parentID === id).map((item) => item.id)
  }

  function state(input: { data: Data; ids: readonly string[]; done: boolean }): Indicator {
    if (input.ids.some((id) => attention(input.data, id))) return "attention"
    if (input.ids.some((id) => working(input.data.session_status[id]))) return "working"
    if (input.done) return "finished"
    return "none"
  }

  function working(status: Status | undefined) {
    return status?.type === "busy" || status?.type === "retry"
  }

  function attention(data: Data, id: string) {
    if (data.session_status[id]?.type === "offline") return true
    if ((data.permission[id]?.length ?? 0) > 0) return true
    if ((data.question[id]?.length ?? 0) > 0) return true
    if ((data.suggestion[id]?.length ?? 0) > 0) return true
    if ((data.network[id]?.length ?? 0) > 0) return true
    return plan(data, id)
  }

  function plan(data: Data, id: string) {
    const msg = data.message[id]?.at(-1)
    if (msg?.role !== "assistant") return false
    return (data.part[msg.id] ?? []).some(
      (part) => part.type === "tool" && part.tool === "plan_exit" && part.state?.status === "completed",
    )
  }
}
