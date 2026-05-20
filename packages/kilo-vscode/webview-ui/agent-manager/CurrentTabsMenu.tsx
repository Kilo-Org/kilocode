/** @jsxImportSource solid-js */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { Accessor, Component } from "solid-js"
import { Popover } from "@kilocode/kilo-ui/popover"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import type { PermissionRequest, QuestionRequest, SessionInfo, SessionStatusInfo } from "../src/types/messages"
import type { TerminalStateControls } from "./terminal"

interface CurrentTabItem {
  id: string
  title: string
  status?: string
  working: boolean
  tone: "active" | "busy" | "waiting" | "idle"
}

interface CurrentTabItemsDeps {
  tabIds: Accessor<string[]>
  tabLookup: Accessor<Map<string, SessionInfo>>
  statusMap: Accessor<Record<string, SessionStatusInfo>>
  permissions: Accessor<PermissionRequest[]>
  questions: Accessor<QuestionRequest[]>
  visibleTabId: Accessor<string | undefined>
  terms: TerminalStateControls
  reviewId: string
  isTerminal: (id: string) => boolean
  isPending: (id: string) => boolean
  t: (key: string) => string
}

interface FocusTabDeps {
  id: string
  terms: TerminalStateControls
  isTerminal: (id: string) => boolean
  isPending: (id: string) => boolean
  reviewId: string
  reviewOpen: Accessor<boolean>
  setReviewOpen: (open: boolean) => void
  setReviewActive: (active: boolean) => void
  tabLookup: Accessor<Map<string, SessionInfo>>
  setActivePendingId: (id: string | undefined) => void
  clearSession: () => void
  selectSession: (id: string) => void
  activateTerminal: (id: string) => void
}

export function focusCurrentTab(deps: FocusTabDeps) {
  if (deps.isTerminal(deps.id)) {
    deps.activateTerminal(deps.id)
    return
  }
  deps.terms.setActiveId(undefined)
  if (deps.id === deps.reviewId) {
    if (!deps.reviewOpen()) deps.setReviewOpen(true)
    deps.setReviewActive(true)
    return
  }
  const target = deps.tabLookup().get(deps.id)
  if (!target) return
  deps.setReviewActive(false)
  if (deps.isPending(target.id)) {
    deps.setActivePendingId(target.id)
    deps.clearSession()
    return
  }
  deps.setActivePendingId(undefined)
  deps.selectSession(target.id)
}

export const createCurrentTabItems = (deps: CurrentTabItemsDeps): Accessor<CurrentTabItem[]> =>
  createMemo(() => {
    const statuses = deps.statusMap()
    const perms = deps.permissions()
    const qs = deps.questions()
    return deps
      .tabIds()
      .map((id) => buildItem(id, statuses, perms, qs, deps))
      .filter((item): item is CurrentTabItem => item !== undefined)
  })

const basicItem = (id: string, title: string, deps: CurrentTabItemsDeps): CurrentTabItem => ({
  id,
  title,
  working: false,
  tone: id === deps.visibleTabId() ? "active" : "idle",
})

function buildReviewItem(id: string, deps: CurrentTabItemsDeps) {
  return basicItem(id, deps.t("session.tab.review"), deps)
}

function buildTerminalItem(id: string, deps: CurrentTabItemsDeps) {
  const term = deps.terms.lookup().get(id)
  if (!term) return undefined
  return basicItem(id, term.title, deps)
}

function buildPendingItem(tab: SessionInfo, deps: CurrentTabItemsDeps) {
  return basicItem(tab.id, tab.title || deps.t("agentManager.session.newSession"), deps)
}

function buildSessionItem(
  tab: SessionInfo,
  status: SessionStatusInfo | undefined,
  blocked: boolean,
  deps: CurrentTabItemsDeps,
) {
  const working = !blocked && (status?.type === "busy" || status?.type === "retry")
  return {
    id: tab.id,
    title: tab.title || deps.t("agentManager.session.untitled"),
    status: statusLabel(tab.id, blocked, status, deps),
    working,
    tone: statusTone(tab.id, blocked, working, deps),
  } satisfies CurrentTabItem
}

function buildItem(
  id: string,
  statuses: Record<string, SessionStatusInfo>,
  perms: PermissionRequest[],
  qs: QuestionRequest[],
  deps: CurrentTabItemsDeps,
): CurrentTabItem | undefined {
  if (id === deps.reviewId) return buildReviewItem(id, deps)
  if (deps.isTerminal(id)) return buildTerminalItem(id, deps)
  const tab = deps.tabLookup().get(id)
  if (!tab) return undefined
  if (deps.isPending(id)) return buildPendingItem(tab, deps)
  const blocked = perms.some((p) => p.sessionID === id) || qs.some((q) => q.sessionID === id)
  return buildSessionItem(tab, statuses[id], blocked, deps)
}

function statusLabel(id: string, blocked: boolean, status: SessionStatusInfo | undefined, deps: CurrentTabItemsDeps) {
  if (blocked) return deps.t("agentManager.tabsMenu.status.waiting")
  if (status?.type === "busy") return deps.t("agentManager.tabsMenu.status.working")
  if (status?.type === "retry") return deps.t("agentManager.tabsMenu.status.retry")
  return undefined
}

function statusTone(id: string, blocked: boolean, working: boolean, deps: CurrentTabItemsDeps): CurrentTabItem["tone"] {
  if (id === deps.visibleTabId()) return "active"
  if (blocked) return "waiting"
  if (working) return "busy"
  return "idle"
}

interface CurrentTabsMenuProps {
  items: Accessor<CurrentTabItem[]>
  label: string
  searchLabel: string
  emptyLabel: string
  activeId: Accessor<string | undefined>
  onSelect: (id: string) => void
}

function SearchIcon() {
  return (
    <svg class="am-tabs-search-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6.8" cy="6.8" r="4.3" />
      <path d="M10.2 10.2L13.5 13.5" />
    </svg>
  )
}

export const CurrentTabsMenu: Component<CurrentTabsMenuProps> = (props) => {
  const [search, setSearch] = createSignal("")
  const [open, setOpen] = createSignal(false)
  const [mark, setMark] = createSignal(0)
  let input: HTMLInputElement | undefined

  const focus = () => {
    input?.focus({ preventScroll: true })
  }

  createEffect(() => {
    if (!open()) return
    setSearch("")
    queueMicrotask(focus)
  })

  const rows = createMemo(() => {
    const q = search().trim().toLowerCase()
    if (!q) return props.items()
    return props.items().filter((item) => item.title.toLowerCase().includes(q))
  })

  createEffect(() => {
    if (!open()) return
    search()
    setMark(0)
  })

  const select = (id: string) => {
    props.onSelect(id)
    setOpen(false)
  }

  const move = (dir: 1 | -1) => {
    const len = rows().length
    if (len === 0) return
    setMark((prev) => (prev + dir + len) % len)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      move(1)
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      move(-1)
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      const item = rows()[mark()]
      if (item) select(item.id)
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <Popover
      placement="bottom-start"
      open={open()}
      onOpenChange={setOpen}
      modal={false}
      class="am-tabs-menu"
      trigger={
        <Tooltip value={props.label} placement="top" gutter={8} inactive={open()}>
          <button class="am-tabs-menu-trigger" type="button" aria-label={props.label}>
            <SearchIcon />
          </button>
        </Tooltip>
      }
    >
      <div class="am-tabs-menu-search">
        <input
          ref={input}
          data-agent-manager-native-text-shortcuts
          data-autofocus
          class="am-tabs-menu-search-input"
          value={search()}
          aria-label={props.searchLabel}
          placeholder={props.searchLabel}
          onKeyDown={onKeyDown}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>
      <div class="am-tabs-menu-list">
        <Show when={rows().length > 0} fallback={<div class="am-tabs-menu-empty">{props.emptyLabel}</div>}>
          <For each={rows()}>
            {(item) => (
              <button
                class={`am-tabs-menu-item ${item.id === props.activeId() ? "am-tabs-menu-item-active" : ""} ${rows()[mark()]?.id === item.id ? "am-tabs-menu-item-marked" : ""}`}
                type="button"
                aria-current={item.id === props.activeId() ? "page" : undefined}
                onMouseMove={() => setMark(rows().findIndex((row) => row.id === item.id))}
                onClick={() => select(item.id)}
              >
                <Show when={item.working}>
                  <span class="am-tabs-menu-indicator">
                    <Spinner class="am-worktree-spinner am-tabs-menu-spinner" />
                  </span>
                </Show>
                <span class="am-tabs-menu-title">{item.title}</span>
                <Show when={item.status !== undefined && item.tone !== "active"}>
                  <span class="am-tabs-menu-status" data-tone={item.tone}>
                    {item.status}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>
    </Popover>
  )
}
