import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { List } from "@kilocode/kilo-ui/list"
import type { ListRef } from "@kilocode/kilo-ui/list"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Show, createEffect, createMemo, createSignal, type Component, type JSX } from "solid-js"

interface SessionTabSwitcherItem {
  id: string
  title: string
  active: boolean
  busy: boolean
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
}

export const SessionTabSwitcher: Component<SessionTabSwitcherProps> = (props) => {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)
  const [notice, setNotice] = createSignal("")
  let list: ListRef | undefined
  let root: HTMLDivElement | undefined

  const current = createMemo(() => props.items().find((item) => item.active))

  const focus = (reset = false) =>
    queueMicrotask(() => {
      if (reset) list?.setFilter("")
      root?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true })
    })

  createEffect(() => {
    if (open()) focus(true)
  })

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

  return (
    <Tooltip value={props.labels.open} placement="bottom" gutter={8} inactive={open()}>
      <Popover
        placement="bottom-end"
        open={open()}
        onOpenChange={setOpen}
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
          "aria-label": props.labels.open,
        }}
      >
        <div ref={root} class="search-menu session-tab-switcher">
          <List<SessionTabSwitcherItem>
            ref={(value) => {
              list = value
            }}
            items={props.items()}
            key={(item) => item.id}
            filterKeys={["title"]}
            current={current()}
            noInitialSelection
            search={{ placeholder: props.labels.search, autofocus: true }}
            onKeyEvent={key}
            onMove={(item) => setNotice(item ? item.title : "")}
            onSelect={(item) => {
              if (item) select(item)
            }}
            itemWrapper={wrap}
          >
            {(item) => (
              <span class="search-menu-row">
                <span class="search-menu-icon">
                  <Show when={!item.busy} fallback={<Spinner class="search-menu-spinner" />}>
                    <Icon name="speech-bubble" size="small" />
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
