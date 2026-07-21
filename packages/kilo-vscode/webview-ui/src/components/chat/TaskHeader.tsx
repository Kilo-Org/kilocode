/**
 * TaskHeader component
 * Sticky header above the chat messages showing session title,
 * cost, context usage, and a compact button.
 * Also shows todo progress when the session has todos.
 *
 * When expanded, shows the task timeline (colored bars representing
 * session activity) and a context window progress bar.
 */

import { Component, For, Show, createMemo, createSignal, createEffect, on, onMount, onCleanup } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Checkbox } from "@kilocode/kilo-ui/checkbox"
import { useSession } from "../../context/session"
import { useMemory } from "../../context/memory"
import { useDisplay } from "../../context/display"
import { calcTokenUsage, collapseCostBreakdown, latestMetrics } from "../../context/session-utils"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { TaskTimeline } from "./TaskTimeline"
import { ContextProgress } from "./ContextProgress"
import { TaskUsage } from "./TaskUsage"
import { TranscriptSearch } from "./TranscriptSearch"
import { useTranscriptSearch } from "../../context/transcript-search"
import { hasModelUsage, tokenSummary } from "../../context/model-usage"
import { SessionRenameEditor } from "../shared/SessionRenameEditor"
import { target as todoTarget } from "../../context/todo-revert"
import type { Part, TodoItem, ExtensionMessage } from "../../types/messages"

interface TaskHeaderProps {
  readonly?: boolean
}

export const TaskHeader: Component<TaskHeaderProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const search = useTranscriptSearch()
  const display = useDisplay()

  const title = createMemo(() => session.currentSession()?.title ?? language.t("command.session.new"))
  const canRename = createMemo(() => !props.readonly && !!session.currentSession())
  const hasMessages = createMemo(() => session.messages().length > 0)
  const busy = createMemo(() => session.status() === "busy")
  const canCompact = createMemo(() => !busy() && session.visibleMessages().length > 0 && !!session.selected())

  const fmt = (n: number) => new Intl.NumberFormat(language.locale(), { style: "currency", currency: "USD" }).format(n)

  const breakdown = () => session.costBreakdown()

  const cost = createMemo(() => {
    const total = breakdown().reduce((sum, e) => sum + e.cost, 0)
    if (total === 0) return undefined
    return fmt(total)
  })

  const costTooltip = createMemo(() => {
    const items = breakdown()
    if (items.length <= 1) return <span>{language.t("context.usage.sessionCost")}</span>
    const collapsed = collapseCostBreakdown(items, (n) =>
      language.t("context.usage.olderSessions", { count: String(n) }),
    )
    return (
      <div style={{ "text-align": "left", "white-space": "nowrap" }}>
        <For each={collapsed}>{(e) => <div>{`${e.label}: ${fmt(e.cost)}`}</div>}</For>
      </div>
    )
  })

  const context = createMemo(() => {
    const usage = session.contextUsage()
    if (!usage) return undefined
    const tokens = usage.tokens.toLocaleString(language.locale())
    const pct = usage.percentage !== null ? `${usage.percentage}%` : undefined
    return { tokens, pct }
  })

  const tokens = createMemo(() => {
    const usage = session.modelUsage()
    return hasModelUsage(usage) ? tokenSummary(usage) : calcTokenUsage(session.visibleMessages())
  })

  const hasTimeline = createMemo(() => {
    for (const m of session.visibleMessages()) {
      if (m.role !== "assistant") continue
      if (session.getParts(m.id).some((p) => p.type !== "step-start")) return true
    }
    return false
  })

// Throughput is the latest step-finish snapshot across the session so the
  // figure reflects the most recent assistant turn rather than a session-wide
  // average. Result is consumed by the TaskUsage summary row, which renders
  // the value inline with the token counts — there is no standalone element.
  const throughput = createMemo(() => {
    const all = session.allParts() as Record<string, Part[]>
    const flat: Part[] = []
    for (const parts of Object.values(all)) {
      for (const part of parts) flat.push(part)
    }
    return latestMetrics(flat)
  })

  const memoryVerbose = createMemo(() => Boolean(memory.status()?.state.verbose))
  const memoryActive = createMemo(() => {
    if (!memory.enabled()) return false
    const stats = memory.status()?.state.stats
    return !!stats && stats.lastInjectedSessionID === session.currentSessionID() && stats.lastInjectedTokens > 0
  })
  const memoryStatus = createMemo(() => {
    if (memory.error()) return memory.error()!
    if (memory.loading()) return language.t("chat.memory.status.loading")
    if (!memory.enabled()) return language.t("chat.memory.project.disabled")
    if (memoryActive()) return language.t("chat.memory.status.active")
    return language.t("chat.memory.project.enabled")
  })
  const activity = createMemo(() => [...memory.activity()].sort((a, b) => b.at - a.at))
  const activityLines = createMemo(() => {
    if (memory.error() || !memory.enabled()) return []
    const loaded = activity().reduce((sum, item) => sum + (item.type === "loaded" ? item.tokens : 0), 0)
    const recalled = activity().reduce((sum, item) => sum + (item.type === "recalled" ? item.count : 0), 0)
    const saved = activity().reduce((sum, item) => sum + (item.type === "saved" ? item.count : 0), 0)
    return [
      ...(loaded > 0
        ? [language.t("chat.memory.activity.loaded", { tokens: loaded.toLocaleString(language.locale()) })]
        : []),
      ...(recalled > 0
        ? [language.t("chat.memory.activity.recalled", { count: recalled.toLocaleString(language.locale()) })]
        : []),
      ...(saved > 0
        ? [language.t("chat.memory.activity.saved", { count: saved.toLocaleString(language.locale()) })]
        : []),
    ]
  })
  const activityItems = createMemo(() =>
    activity()
      .flatMap((item) => {
        const values =
          item.type === "saved" ? [...item.refs, ...item.items] : item.items.length > 0 ? item.items : item.refs
        return values.flatMap((value) => {
          const text = value.trim()
          return text ? [{ type: item.type, value: text }] : []
        })
      })
      .slice(0, 5),
  )
  const activityLabel = (item: { type: MemoryActivity["type"]; value: string }) =>
    language.t(`chat.memory.activity.${item.type}.item`, { item: item.value })
  const activitySummaryView = () => (
    <div data-slot="task-header-memory-activity">
      <Show
        when={activityLines().length > 0}
        fallback={<div data-slot="task-header-memory-activity-summary">{language.t("chat.memory.activity.idle")}</div>}
      >
        <div data-slot="task-header-memory-activity-summary">
          <For each={activityLines()}>{(line) => <div>{line}</div>}</For>
        </div>
      </Show>
    </div>
  )
  const activityTooltip = () => (
    <>
      <div data-slot="task-header-context-tooltip-title">{language.t("settings.context.title")}</div>
      <div data-slot="task-header-context-tooltip-status">{memoryStatus()}</div>
      {activitySummaryView()}
      <Show when={memoryVerbose() && activityItems().length > 0}>
        <div data-slot="task-header-memory-activity-list">
          <For each={activityItems()}>{(item) => <div>{activityLabel(item)}</div>}</For>
        </div>
      </Show>
    </>
  )
  const vscode = useVSCode()
  const [expanded, setExpanded] = createSignal(true)
  // Throughput row visibility is shared with AssistantMessage via the
  // DisplayProvider so the setting toggles both surfaces together.
  const throughputVisible = createMemo(() => display.throughputVisible())

  // Read initial value from VS Code settings
  onMount(() => vscode.postMessage({ type: "requestTimelineSetting" }))
  const handler = (e: MessageEvent<ExtensionMessage>) => {
    if (e.data.type === "timelineSettingLoaded") setExpanded(e.data.visible)
  }
  window.addEventListener("message", handler)
  onCleanup(() => window.removeEventListener("message", handler))

  // "Kilo Code: Toggle Chat Search" (Command Palette) toggles the search
  // bar from here rather than TranscriptSearch.tsx itself: that component
  // only mounts once search.active() is already true (it's behind a
  // <Show>), so it can never be what turns search on in the first place —
  // and it also wouldn't exist anymore to react to a request to close it.
  // TaskHeader is mounted the whole time there's an active chat, so it's
  // the right place to react to the external toggle request.
  const toggleSearch = () => (search.active() ? search.closeSearch() : search.setActive(true))
  window.addEventListener("focusTranscriptSearch", toggleSearch)
  onCleanup(() => window.removeEventListener("focusTranscriptSearch", toggleSearch))

  // Whenever search closes via an explicit user action — the header toggle
  // button, the command palette toggle above, the search bar's own "X", or
  // Escape — send focus back to the chat input rather than leaving it
  // stranded on whatever control was just clicked/removed. Watches
  // `closeSignal` rather than `active()` transitions so that MessageList
  // silently resetting the widget on a session/tab change (which also
  // flips `active()` false) can't trigger this same aggressive restore and
  // steal focus back from the tab strip's own focus handling. `defer: true`
  // skips the initial run so mounting doesn't immediately steal focus.
  createEffect(
    on(
      () => search.closeSignal(),
      () => {
        window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } }))
      },
      { defer: true },
    ),
  )

  const toggle = () => {
    const next = !expanded()
    setExpanded(next)
    vscode.postMessage({ type: "updateSetting", key: "showTaskTimeline", value: next })
  }

  const todos = createMemo(() => session.todos())
  const hasTodos = createMemo(() => todos().length > 0)
  const doneCount = createMemo(() => todos().filter((t: TodoItem) => t.status === "completed").length)
  const totalCount = createMemo(() => todos().length)
  const allDone = createMemo(() => doneCount() === totalCount() && totalCount() > 0)

  const todoSummary = createMemo(() => {
    const done = doneCount()
    const total = totalCount()
    if (total === 0) return ""
    if (done === total) return language.t("task.todos.allDone", { count: String(total) })
    return language.t("task.todos.progress", { done: String(done), total: String(total) })
  })

  const [todosOpen, setTodosOpen] = createSignal(false)
  const [renaming, setRenaming] = createSignal<{ id: string; title: string }>()

  const startRename = () => {
    if (props.readonly) return
    const info = session.currentSession()
    if (!info) return
    setRenaming({ id: info.id, title: info.title ?? "" })
  }

  const commitRename = (title: string) => {
    const info = renaming()
    if (!info) return
    setRenaming(undefined)
    if (title === info.title) return
    session.renameSession(info.id, title)
  }

  const cancelRename = () => {
    setRenaming(undefined)
  }

  createEffect(() => {
    const info = renaming()
    if (info && session.currentSession()?.id !== info.id) setRenaming(undefined)
  })

  const donePart = (idx: number): Part | undefined =>
    todoTarget({ messages: session.messages(), parts: session.allParts() }, idx)

  const revertTodo = (part: Part | undefined) => {
    if (session.status() !== "idle") return
    if (part?.type !== "tool") return
    if (!part.messageID) return
    session.revertSession(part.messageID, part.id)
  }

  return (
    <Show when={hasMessages()}>
      <div data-component="task-header">
        <div data-slot="task-header-title">
          <Show
            when={!renaming()}
            fallback={
              <SessionRenameEditor
                title={renaming()?.title ?? ""}
                autosize
                onSave={commitRename}
                onCancel={cancelRename}
              />
            }
          >
            <span
              data-slot="task-header-title-trigger"
              data-renamable={canRename() ? "" : undefined}
              title={canRename() ? language.t("agentManager.worktree.doubleClickRename") : title()}
              tabIndex={canRename() ? 0 : undefined}
              role={canRename() ? "button" : undefined}
              onDblClick={startRename}
              onKeyDown={(e) => {
                if (!canRename() || (e.key !== "Enter" && e.key !== " ")) return
                e.preventDefault()
                startRename()
              }}
            >
              <span data-slot="task-header-title-label" dir="auto">
                {title()}
              </span>
            </span>
          </Show>
        </div>
        <div data-slot="task-header-stats">
          <Show when={cost()}>
            {(c) => (
              <Tooltip value={costTooltip()} placement="bottom">
                <span>{c()}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={context()}>
            {(ctx) => (
              <Tooltip
                value={ctx().pct ? `${ctx().tokens} tokens (${ctx().pct} of context)` : `${ctx().tokens} tokens`}
                placement="bottom"
              >
                <span>{ctx().pct ?? ctx().tokens}</span>
              </Tooltip>
            )}
          </Show>
          <Show when={!props.readonly}>
            <Tooltip value={language.t("command.session.compact")} placement="bottom">
              <IconButton
                icon="compress"
                size="small"
                variant="ghost"
                disabled={!canCompact()}
                onClick={() => session.compact()}
                aria-label={language.t("command.session.compact")}
              />
            </Tooltip>
          </Show>
          <Show when={hasMessages()}>
            <Tooltip value={language.t("chat.search.toggle")} placement="bottom">
              <IconButton
                icon="magnifying-glass"
                size="small"
                variant="ghost"
                class="task-header-search-toggle"
                data-active={search.active() ? "" : undefined}
                onClick={toggleSearch}
                aria-label={language.t("chat.search.toggle")}
                aria-pressed={search.active()}
              />
            </Tooltip>
            <button
              data-slot="task-header-expand"
              onClick={toggle}
              aria-expanded={expanded()}
              aria-label="Toggle timeline"
            >
              <Icon name="chevron-down" size="small" style={expanded() ? { transform: "rotate(180deg)" } : undefined} />
            </button>
          </Show>
        </div>
      </div>
      {/* Standalone search bar, directly under the header, so it has room for
          the VS Code–style inline options and doesn't require the timeline
          to be expanded. */}
      <Show when={search.active()}>
        <div data-component="task-header-search">
          <TranscriptSearch />
        </div>
      </Show>
      {/* Expanded graph section: timeline + context bar + token breakdown */}
      <Show when={expanded() && hasTimeline()}>
        <div data-component="task-header-graph">
          <TaskTimeline />
          <div data-slot="task-header-graph-row">
            <ContextProgress />
          </div>
          <Show when={tokens()}>
            {(tk) => (
              <TaskUsage
                tokens={tk()}
                usage={session.modelUsage()}
                throughput={throughputVisible() ? throughput()?.generation : undefined}
              />
            )}
          </Show>
        </div>
      </Show>
      <Show when={hasTodos()}>
        <div data-component="task-header-todos">
          <button
            data-slot="task-header-todos-trigger"
            onClick={() => setTodosOpen((v) => !v)}
            aria-expanded={todosOpen()}
          >
            <Icon name="checklist" size="small" />
            <span data-slot="task-header-todos-summary" data-all-done={allDone() ? "" : undefined}>
              {todoSummary()}
            </span>
            <Icon
              name="chevron-down"
              size="small"
              data-slot="task-header-todos-arrow"
              data-open={todosOpen() ? "" : undefined}
            />
          </button>
          <Show when={todosOpen()}>
            <div data-slot="task-header-todos-list">
              <For each={todos()}>
                {(todo: TodoItem, idx) => {
                  const part = createMemo(() => (todo.status === "completed" ? donePart(idx()) : undefined))
                  return (
                    <Tooltip value={part() ? language.t("settings.checkpoints.title") : undefined} placement="bottom">
                      <Checkbox readOnly checked={todo.status === "completed"} onClick={() => revertTodo(part())}>
                        <span
                          data-slot="task-header-todo-content"
                          data-completed={todo.status === "completed" ? "" : undefined}
                        >
                          {todo.content}
                        </span>
                      </Checkbox>
                    </Tooltip>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  )
}
