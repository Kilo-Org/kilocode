import { createMemo, For, Show } from "solid-js"
import { useBoardNavigation, type BoardSessionNavigation } from "../context/board-navigation"
import { useI18n } from "../context/i18n"
import { Icon } from "./icon"
import { AgentAvatar, useAgentAvatarIds } from "./agent-avatar"
import { Markdown } from "./markdown"
import { Tooltip } from "./tooltip"

// The parent session keeps the plain spinner grid; only subagents get a glyph.
function Member(props: {
  id: string
  label?: string
  onSessionClick?: BoardSessionNavigation
  semantic?: boolean
  active?: boolean
}) {
  const open = () => props.onSessionClick
  const semantic = () => props.semantic !== false
  const clickable = () => props.id !== "main" && !!open()
  const label = () => props.label || props.id
  const activate = () => open()?.(props.id, props.label)
  const click = (event: MouseEvent) => {
    if (!clickable()) return
    event.stopPropagation()
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    event.preventDefault()
    activate()
  }
  const key = (event: KeyboardEvent) => {
    if (!clickable() || (event.key !== "Enter" && event.key !== " ")) return
    event.preventDefault()
    event.stopPropagation()
    activate()
  }

  return (
    <Show when={props.id !== "main"} fallback={<Icon class="board-route-parent" name="task" size="small" />}>
      <Show when={clickable()} fallback={<AgentAvatar id={props.id} status={props.active ? "running" : undefined} />}>
        <span
          data-slot="board-route-avatar"
          data-clickable="true"
          role={semantic() ? "button" : undefined}
          tabIndex={semantic() ? 0 : undefined}
          aria-label={semantic() ? label() : undefined}
          title={label()}
          onClick={click}
          onKeyDown={semantic() ? key : undefined}
        >
          <AgentAvatar id={props.id} status={props.active ? "running" : undefined} />
        </span>
      </Show>
    </Show>
  )
}

export function BoardParticipantStack(props: {
  ids: string[]
  onSessionClick?: BoardSessionNavigation
  semantic?: boolean
}) {
  const open = () => props.onSessionClick
  const semantic = () => props.semantic !== false
  return (
    <span data-component="board-participant-stack" aria-hidden={semantic() && open() ? undefined : "true"}>
      <Show when={props.ids.length > 0} fallback={<Icon name="task" size="small" />}>
        <For each={props.ids}>{(id) => <Member id={id} onSessionClick={open()} semantic={semantic()} />}</For>
      </Show>
    </span>
  )
}

type Route = {
  from?: unknown
  to?: unknown
  fromLabel?: unknown
  toLabel?: unknown
  onSessionClick?: BoardSessionNavigation
  semantic?: boolean
}

/** `pending` animates the route while the post is still being written or stored. */
export function BoardRoute(props: Route & { pending?: boolean }) {
  const i18n = useI18n()
  const ids = useAgentAvatarIds()
  const open = () => props.onSessionClick
  const text = (value: unknown) => (typeof value === "string" ? value : "")
  const from = () => text(props.from)
  const to = () => text(props.to)
  const broadcast = createMemo(() => {
    const values = ids().filter((id) => id !== "main" && id !== from())
    if (from() !== "main" && values.length > 0) values.unshift("main")
    return values
  })
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
      data-pending={props.pending ? "true" : undefined}
      role="group"
      aria-label={i18n.t("ui.messagePart.board.route", { from: sender(), to: recipient() })}
    >
      <Member id={from()} label={sender()} onSessionClick={open()} semantic={props.semantic} active={props.pending} />
      <Tooltip
        class="board-route-member board-route-sender"
        contentClass="board-route-tooltip"
        value={detail(sender(), from())}
      >
        {sender()}
      </Tooltip>
      <span data-slot="board-route-arrow">
        <Icon name="arrow-right" size="small" />
      </span>
      <span data-slot="board-route-recipient-icon" data-broadcast={to() === "ALL"}>
        <Show
          when={to() === "ALL"}
          fallback={
            <Member
              id={to()}
              label={recipient()}
              onSessionClick={open()}
              semantic={props.semantic}
              active={props.pending && !to()}
            />
          }
        >
          <Show
            when={broadcast().length > 0}
            fallback={
              <>
                <Icon name="task" size="small" />
                <Icon name="task" size="small" />
              </>
            }
          >
            <BoardParticipantStack ids={broadcast()} onSessionClick={open()} semantic={props.semantic} />
          </Show>
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
  const navigation = useBoardNavigation()
  const open = () => props.onSessionClick ?? navigation

  return (
    <div data-slot="board-message">
      <Show when={props.route !== false}>
        <BoardRoute {...props} onSessionClick={open()} semantic />
      </Show>
      <div data-slot="board-message-body">
        <Markdown text={props.body} />
      </div>
    </div>
  )
}
