/** @jsxImportSource solid-js */

import { Show, createEffect, createSignal } from "solid-js"
import type { Accessor, Component } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { List } from "@kilocode/kilo-ui/list"
import type { ListRef } from "@kilocode/kilo-ui/list"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { formatRelativeDate } from "../src/utils/date"
import { colorCss } from "./section-colors"
import type { SidebarSearchItem } from "./sidebar-search"

export interface SidebarSearchMenuRef {
  open: () => void
}

interface SidebarSearchMenuProps {
  items: Accessor<SidebarSearchItem[]>
  current: Accessor<SidebarSearchItem | undefined>
  labels: { search: string; scope: string; contexts: string; sessions: string; waiting: string; retry: string }
  keybind: string
  ref?: (value: SidebarSearchMenuRef) => void
  onSelect: (item: SidebarSearchItem) => void
  defaultOpen?: boolean
  portal?: boolean
}

export const SidebarSearchMenu: Component<SidebarSearchMenuProps> = (props) => {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)
  const [query, setQuery] = createSignal("")
  const [notice, setNotice] = createSignal("")
  let list: ListRef | undefined
  let root: HTMLDivElement | undefined

  const focus = () =>
    queueMicrotask(() => {
      list?.setFilter("")
      root?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true })
    })

  createEffect(() => {
    if (open()) focus()
  })

  const reveal = () => {
    setOpen(true)
    focus()
  }
  props.ref?.({ open: reveal })

  const refocus = () =>
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
  const close = (next: boolean) => {
    setOpen(next)
    if (!next) refocus()
  }

  const select = (item: SidebarSearchItem) => {
    setOpen(false)
    props.onSelect(item)
    refocus()
  }

  return (
    <TooltipKeybind title={props.labels.scope} keybind={props.keybind} placement="top" gutter={8} inactive={open()}>
      <Popover
        placement="bottom-start"
        open={open()}
        onOpenChange={close}
        modal={false}
        portal={props.portal}
        class="am-sidebar-search-popover"
        triggerAs="button"
        triggerProps={{
          type: "button",
          class: "am-sidebar-search-trigger",
          "aria-label": props.labels.search,
        }}
        trigger={<Icon name="magnifying-glass" size="small" />}
      >
        <div ref={root} class="am-sidebar-search" data-agent-manager-native-text-shortcuts>
          <List<SidebarSearchItem>
            ref={(value) => {
              list = value
            }}
            items={props.items()}
            key={(item) => item.key}
            filterKeys={["title", "search"]}
            current={props.current()}
            groupBy={(item) => (query() ? "" : item.group)}
            groupHeader={(group) => (group.category === "sessions" ? props.labels.sessions : props.labels.contexts)}
            sortGroupsBy={(a, b) => (a.category === "sessions" ? -1 : b.category === "sessions" ? 1 : 0)}
            search={{ placeholder: props.labels.search }}
            onFilter={setQuery}
            onMove={(item) => setNotice(item ? [item.title, ...item.meta].join(", ") : "")}
            onSelect={(item) => {
              if (item) select(item)
            }}
          >
            {(item) => {
              const working = item.state === "busy" || item.state === "retry"
              return (
                <span
                  class="am-sidebar-search-result"
                  data-slot="sidebar-search-result"
                  data-kind={item.kind}
                  data-state={item.state}
                  data-session-id={item.kind === "session" ? item.sessionId : undefined}
                  data-worktree-id={item.kind === "worktree" ? item.worktreeId : undefined}
                >
                  <span class="am-sidebar-search-icon">
                    <Show when={!working} fallback={<Spinner class="am-sidebar-search-spinner" />}>
                      <Show
                        when={item.kind !== "local"}
                        fallback={
                          <svg class="am-local-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <rect x="2.5" y="3.5" width="15" height="10" rx="1" stroke="currentColor" />
                            <path d="M6 16.5H14M10 13.5V16.5" stroke="currentColor" />
                          </svg>
                        }
                      >
                        <Icon name={item.kind === "worktree" ? "branch" : "speech-bubble"} size="small" />
                      </Show>
                    </Show>
                  </span>
                  <span class="am-sidebar-search-copy">
                    <span class="am-sidebar-search-title">{item.title}</span>
                    <span class="am-sidebar-search-meta">
                      <Show when={item.section}>
                        {(section) => (
                          <span
                            class="am-sidebar-search-swatch"
                            style={{ background: colorCss(section().color) ?? "var(--border-weak-base)" }}
                          />
                        )}
                      </Show>
                      <span>{item.meta.join(" · ")}</span>
                    </span>
                  </span>
                  <Show when={item.state === "waiting"}>
                    <span class="am-sidebar-search-status">{props.labels.waiting}</span>
                  </Show>
                  <Show when={item.state === "retry"}>
                    <span class="am-sidebar-search-status">{props.labels.retry}</span>
                  </Show>
                  <Show when={item.kind !== "session" && item.state === "idle"}>
                    <span class="am-sidebar-search-count">{item.kind !== "session" ? item.count : ""}</span>
                  </Show>
                  <Show when={item.kind === "session" && item.state === "idle"}>
                    <span class="am-sidebar-search-time">{formatRelativeDate(item.updatedAt)}</span>
                  </Show>
                </span>
              )
            }}
          </List>
          <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {notice()}
          </div>
        </div>
      </Popover>
    </TooltipKeybind>
  )
}
