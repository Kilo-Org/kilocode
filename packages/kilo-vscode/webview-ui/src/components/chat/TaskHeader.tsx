/**
 * TaskHeader component
 * Sticky header above the chat messages showing session title,
 * cost, context usage, and a compact button.
 * Todo progress lives in the session dock (see TodoChip).
 *
 * When expanded, shows the task timeline (colored bars representing
 * session activity) and a context window progress bar.
 */

import { Component, For, Show, createMemo, createSignal, createEffect, on, onMount, onCleanup } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useSession } from "../../context/session"
import { calcTokenUsage, collapseCostBreakdown, sessionCost } from "../../context/session-utils"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { TaskTimeline } from "./TaskTimeline"
import { ContextProgress } from "./ContextProgress"
import { TaskUsage } from "./TaskUsage"
import { TranscriptSearch } from "./TranscriptSearch"
import { useTranscriptSearch } from "../../context/transcript-search"
import { hasModelUsage, sessionModel, tokenSummary } from "../../context/model-usage"
import { useProvider } from "../../context/provider"
import { buildTriggerLabel, sanitizeName } from "../shared/model-selector-utils"
import { SessionRenameEditor } from "../shared/SessionRenameEditor"
import type { ExtensionMessage } from "../../types/messages"

interface TaskHeaderProps {
  readonly?: boolean
}

export const TaskHeader: Component<TaskHeaderProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const search = useTranscriptSearch()

  const title = createMemo(() => session.currentSession()?.title ?? language.t("command.session.new"))
  const canRename = createMemo(() => !props.readonly && !!session.currentSession())
  const hasMessages = createMemo(() => session.messages().length > 0)
  const busy = createMemo(() => session.status() === "busy")
  const canCompact = createMemo(() => !busy() && session.visibleMessages().length > 0 && !!session.selected())

  const money = createMemo(() => new Intl.NumberFormat(language.locale(), { style: "currency", currency: "USD" }))
  const fmt = (n: number) => money().format(n)

  const breakdown = () => session.costBreakdown()
  const total = createMemo(() => sessionCost(breakdown(), session.currentSession(), session.modelUsage()))

  const cost = createMemo(() => {
    const value = total().total
    if (value === 0) return undefined
    return fmt(value)
  })

  const costTooltip = createMemo(() => {
    const items = breakdown()
    if (items.length <= 1 || total().partial) return <span>{language.t("context.usage.sessionCost")}</span>
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

  // Subagents run with their own model and reasoning effort, so show them in the header.
  // Subagent viewers are read-only and may not have the child session info loaded.
  const provider = useProvider()
  const model = createMemo(() => {
    if (!props.readonly && !session.currentSession()?.parentID) return undefined
    const sel = sessionModel(session.messages())
    if (!sel) return undefined
    const info = provider.findModel(sel)
    const name = buildTriggerLabel(info && sanitizeName(info.name), sel.providerID, sel, false, "", true, {
      select: language.t("dialog.model.select.title"),
      noProviders: language.t("dialog.model.noProviders"),
      notSet: language.t("dialog.model.notSet"),
    })
    const variant = sel.variant ? sel.variant.charAt(0).toUpperCase() + sel.variant.slice(1) : undefined
    return { name, variant, id: `${sel.providerID}/${sel.modelID}` }
  })

  const hasTimeline = createMemo(() => {
    for (const m of session.visibleMessages()) {
      if (m.role !== "assistant") continue
      if (session.getParts(m.id).some((p) => p.type !== "step-start")) return true
    }
    return false
  })

  const vscode = useVSCode()
  const [expanded, setExpanded] = createSignal(true)

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
        <Show when={model()}>
          {(m) => (
            <Tooltip
              class="task-header-model"
              value={
                <div style={{ "text-align": "left", "white-space": "nowrap" }}>
                  <div>{m().id}</div>
                  <Show when={m().variant}>
                    <div>{`${language.t("prompt.thinking.tooltip")}: ${m().variant}`}</div>
                  </Show>
                </div>
              }
              placement="bottom"
            >
              <span data-slot="task-header-model-name">{m().name}</span>
              <Show when={m().variant}>
                <span data-slot="task-header-model-variant">{m().variant}</span>
              </Show>
            </Tooltip>
          )}
        </Show>
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
            <IconButton
              icon="chevron-down"
              size="small"
              variant="ghost"
              data-slot="task-header-expand"
              onClick={toggle}
              aria-expanded={expanded()}
              aria-label="Toggle timeline"
            />
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
      {/* Expanded graph section: timeline + context bar + token breakdown.
          The section always reserves the height of all three rows, so the
          header keeps one height as a turn streams and the transcript never
          moves on a turn boundary. A row with no data shows a skeleton only
          while a turn is running; otherwise it stays empty. */}
      <Show when={expanded()}>
        <div data-component="task-header-graph">
          <Show
            when={hasTimeline()}
            fallback={
              <div class="task-header-skeleton-chart" aria-hidden="true">
                <Show when={busy()}>
                  <For each={[14, 22, 10, 18, 8]}>
                    {(h, i) => (
                      <div
                        class="task-header-skeleton"
                        style={{ height: `${h}px`, "animation-delay": `${i() * 80}ms` }}
                      />
                    )}
                  </For>
                </Show>
              </div>
            }
          >
            <TaskTimeline />
          </Show>
          <div data-slot="task-header-graph-row">
            <ContextProgress />
          </div>
          <Show when={tokens()}>{(tk) => <TaskUsage tokens={tk()} usage={session.modelUsage()} />}</Show>
          <Show when={!tokens()}>
            <div class="task-header-tokens" aria-hidden="true">
              <Show when={busy()}>
                <div class="task-header-skeleton" style={{ width: "42px" }} />
                <div class="task-header-skeleton" style={{ width: "36px" }} />
                <div class="task-header-skeleton" style={{ width: "28px" }} />
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </Show>
  )
}
