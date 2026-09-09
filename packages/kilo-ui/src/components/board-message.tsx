import { Show } from "solid-js"
import { useI18n } from "../context/i18n"
import { Icon } from "./icon"
import { AgentAvatar } from "./agent-avatar"
import { Markdown } from "./markdown"
import { Tooltip } from "./tooltip"

// The parent session keeps the plain spinner grid; only subagents get a glyph.
function Member(props: { id: string }) {
  return (
    <Show when={props.id !== "main"} fallback={<Icon class="board-route-parent" name="task" size="small" />}>
      <AgentAvatar id={props.id} />
    </Show>
  )
}

type Route = { from?: unknown; to?: unknown; fromLabel?: unknown; toLabel?: unknown }

export function BoardRoute(props: Route) {
  const i18n = useI18n()
  const text = (value: unknown) => (typeof value === "string" ? value : "")
  const from = () => text(props.from)
  const to = () => text(props.to)
  const label = (id: string, value: unknown) => {
    if (id === "ALL") return i18n.t("ui.messagePart.board.all")
    const title = text(value)
    if (title.trim()) return title
    if (id === "main") return i18n.t("ui.messagePart.board.primary")
    return id ? `${i18n.t("ui.messagePart.board.agent")} · ${id.slice(-8)}` : i18n.t("ui.messagePart.board.agent")
  }
  const sender = () => label(from(), props.fromLabel)
  const recipient = () => label(to(), props.toLabel)
  const detail = (title: string, id: string) => (
    <div data-slot="board-route-detail">
      <span>{title}</span>
      <Show when={id}>
        <code>{id}</code>
      </Show>
    </div>
  )
  return (
    <span
      data-component="board-route"
      data-broadcast={to() === "ALL"}
      role="group"
      aria-label={i18n.t("ui.messagePart.board.route", { from: sender(), to: recipient() })}
    >
      <Member id={from()} />
      <Tooltip
        class="board-route-member board-route-sender"
        contentClass="board-route-tooltip"
        value={detail(sender(), from())}
      >
        {sender()}
      </Tooltip>
      <Icon name="arrow-right" size="small" />
      <span data-slot="board-route-recipient-icon" data-broadcast={to() === "ALL"}>
        <Show when={to() === "ALL"} fallback={<Member id={to()} />}>
          <Icon name="task" size="small" />
          <Icon name="task" size="small" />
        </Show>
      </span>
      <Tooltip
        class="board-route-member board-route-recipient"
        contentClass="board-route-tooltip"
        value={detail(recipient(), to())}
      >
        {recipient()}
      </Tooltip>
    </span>
  )
}

export function BoardMessage(props: Route & { body: string; route?: boolean }) {
  return (
    <div data-slot="board-message">
      <Show when={props.route !== false}>
        <BoardRoute {...props} />
      </Show>
      <div data-slot="board-message-body">
        <Markdown text={props.body} />
      </div>
    </div>
  )
}
