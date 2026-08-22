import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { List } from "@kilocode/kilo-ui/list"
import type { ListRef } from "@kilocode/kilo-ui/list"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Show, createEffect, createMemo, createSignal, onCleanup, type Component, type JSX } from "solid-js"

interface SessionTabSwitcherItem {
  id: string
  title: string
  active: boolean
  busy: boolean
  input: boolean
  pending: boolean
}

interface SessionTabSwitcherProps {
  items: () => SessionTabSwitcherItem[]
  labels: {
    open: string
    search: string
    close: string
    current: string
    pending: string
    busy: string
  }
  onSelect: (id: string) => void
  onRestore: () => void
  onClose: (id: string) => void
  defaultOpen?: boolean
  portal?: boolean
  placement?: "bottom-start" | "bottom-end"
  hover?: boolean
  autofocus?: boolean
  alert?: () => boolean
}

export const SessionTabSwitcher: Component<SessionTabSwitcherProps> = (props) => {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)
  const [source, setSource] = createSignal<"trigger" | "hover">("trigger")
  const [notice, setNotice] = createSignal("")
  let list: ListRef | undefined
  let root: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const current = createMemo(() => props.items().find((item) => item.active))

  const focus = (reset = false) =>
    queueMicrotask(() => {
      if (reset) list?.setFilter("")
      root?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true })
    })

  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const show = () => {
    if (!props.hover) return
    clear()
    if (!open()) setSource("hover")
    setOpen(true)
  }

  const schedule = () => {
    if (!props.hover) return
    clear()
    timer = setTimeout(() => setOpen(false), 120)
  }

  const hide = () => {
    if (!props.hover) return
    clear()
    setOpen(false)
  }

  onCleanup(clear)

  createEffect(() => {
    if (open() && props.autofocus !== false && source() === "trigger") focus(true)
  })

  const activate = () => {
    setSource("trigger")
    if (open()) focus(true)
  }

  const select = (item: SessionTabSwitcherItem) => {
    setOpen(false)
    props.onSelect(item.id)
    // Restore the prompt after the closing popover finishes its current event.
    queueMicrotask(props.onRestore)
  }

  const remove = (item: SessionTabSwitcherItem) => {
    const last = props.items().length === 2
    props.onClose(item.id)
    setNotice(`${props.labels.close}: ${item.title}`)
    if (last) {
      queueMicrotask(props.onRestore)
      return
    }
    focus()
  }

  const key = (event: KeyboardEvent, item: SessionTabSwitcherItem | undefined) => {
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    const node = event.currentTarget
    const id = node instanceof HTMLElement ? node.dataset.key : undefined
    // With no initial cursor, a row reached by Tab may not be the List's active item.
    const value = props.items().find((row) => row.id === id) ?? item
    if (!value) return
    if (event.key === "Enter") {
      event.preventDefault()
      select(value)
      return
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return
    event.preventDefault()
    remove(value)
  }

  const wrap = (item: SessionTabSwitcherItem, node: JSX.Element) => (
    <div class="session-tab-switcher-item">
      {node}
      <IconButton
        icon="close-small"
        size="normal"
        variant="ghost"
        aria-label={`${props.labels.close}: ${item.title}`}
        class="session-tab-switcher-close"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          remove(item)
        }}
      />
    </div>
  )

  const state = (item: SessionTabSwitcherItem) => {
    if (item.input) return "input"
    if (item.busy) return "running"
    return "stopped"
  }

  return (
    <Tooltip value={props.labels.open} placement="bottom" gutter={8} inactive={open()}>
      <Popover
        placement={props.placement ?? "bottom-end"}
        open={open()}
        onOpenChange={(next) => {
          clear()
          if (next && !open()) setSource("trigger")
          setOpen(next)
        }}
        modal={false}
        portal={props.portal}
        class="search-menu-popover session-tab-switcher-popover"
        contentLabel={props.labels.open}
        triggerAs={IconButton}
        triggerProps={{
          type: "button",
          icon: "bullet-list",
          size: "normal",
          variant: "ghost",
          class: "search-menu-trigger",
          classList: { "session-tab-switcher-trigger-alert": props.alert?.() ?? false },
          "aria-label": props.labels.open,
          onClick: activate,
          onKeyDown: (event) => {
            if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return
            activate()
          },
          onPointerEnter: show,
          onPointerLeave: schedule,
        }}
      >
        <div ref={root} class="search-menu session-tab-switcher" onPointerEnter={show} onPointerLeave={hide}>
          <List<SessionTabSwitcherItem>
            ref={(value) => {
              list = value
            }}
            items={props.items()}
            key={(item) => item.id}
            filterKeys={["title"]}
            current={current()}
            noInitialSelection
            search={{ placeholder: props.labels.search, autofocus: props.autofocus !== false && !props.hover }}
            onKeyEvent={key}
            onMove={(item) => setNotice(item ? item.title : "")}
            onSelect={(item) => {
              if (item) select(item)
            }}
            itemWrapper={wrap}
          >
            {(item) => (
              <span class="search-menu-row">
                <span class="search-menu-icon session-tab-switcher-icon" data-state={state(item)}>
                  <Show
                    when={item.input}
                    fallback={
                      <Show when={item.busy}>
                        <Spinner class="search-menu-spinner" />
                      </Show>
                    }
                  >
                    <span class="session-tab-switcher-question">?</span>
                  </Show>
                </span>
                <span class="search-menu-copy">
                  <span class="search-menu-title" dir="auto">
                    {item.title}
                  </span>
                  <Show when={item.busy || item.pending}>
                    <span class="search-menu-meta session-tab-switcher-meta">
                      <Show when={item.busy} fallback={props.labels.pending}>
                        {props.labels.busy}
                      </Show>
                    </span>
                  </Show>
                </span>
                <Show when={item.active}>
                  <span class="search-menu-status session-tab-switcher-status">{props.labels.current}</span>
                </Show>
              </span>
            )}
          </List>
          <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {notice()}
          </div>
        </div>
      </Popover>
    </Tooltip>
  )
}
