/**
 * TaskHeader component
 * Sticky header above the chat messages showing session title,
 * cost, context usage, and a compact button.
 * Todo progress lives in the session dock (see TodoChip).
 *
 * When expanded, shows the task timeline (colored bars representing
 * session activity), a context window progress bar and the token rows.
 * The expanded state persists in `kilo-code.v2.showTaskTimeline`.
 */

import { Component, For, Show, createMemo, createSignal, createEffect, on, onCleanup, untrack } from "solid-js"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../../context/language"
import { SessionRenameEditor } from "../shared/SessionRenameEditor"
import { useV2 } from "../../v2/client"
import { visibleMessages } from "../../v2/revert"
import { sessionMissing } from "../../v2/scope"
import { setTaskTimelineVisible, taskTimelineVisible } from "../../v2/kilo-settings"
import { useTranscriptSearch } from "../../v2/transcript-search"
import { TranscriptSearchBar } from "../../v2/transcript-search-bar"
import { focusPrompt } from "../../utils/tab-navigation"
import {
  childLabels,
  collapseCostBreakdown,
  costBreakdown,
  fetchSessionMessages,
  latestModel,
  mergeModelUsage,
  modelLabel,
  modelUsage,
  revertedMembers,
  sessionSubtree,
  sessionUsage,
  sumCost,
  sumTokens,
  type ModelUsage,
} from "../../v2/session-usage"
import { TaskTimeline } from "./TaskTimeline"
import { ContextProgress } from "./ContextProgress"
import { TaskUsage } from "./TaskUsage"
import { renderable } from "../../utils/timeline/timeline-parts"

interface TaskHeaderProps {
  sessionID: string
  readonly?: boolean
  /** Whether the Command Palette search toggle reaches this header. A nested view turns it off. */
  searchCommand?: boolean
}

export const TaskHeader: Component<TaskHeaderProps> = (props) => {
  const v2 = useV2()
  const language = useLanguage()
  const info = () => v2.data.session.get(props.sessionID)
  const allMessages = () => v2.data.session.message.list(props.sessionID)
  const messages = createMemo(() => visibleMessages(allMessages(), info()?.revert))
  const models = () => v2.data.location.model.list()
  const providers = createMemo(() => v2.data.location.provider.list() ?? [])

  const title = createMemo(() => info()?.title ?? language.t("command.session.new"))
  const canRename = createMemo(() => !props.readonly && !!info())
  const hasMessages = createMemo(() => allMessages().length > 0 || !!info()?.revert)
  const busy = createMemo(() => v2.data.session.status(props.sessionID) === "running")
  const canCompact = createMemo(() => !busy() && messages().length > 0)

  const money = createMemo(() => new Intl.NumberFormat(language.locale(), { style: "currency", currency: "USD" }))
  const fmt = (n: number) => money().format(n)

  // The viewed session plus its descendants. `family` returns session IDs, so resolve each one first.
  const members = createMemo(() => {
    const id = props.sessionID
    const ids = new Set([id, ...v2.data.session.family(id)])
    const list = [...ids].flatMap((memberID) => {
      const member = v2.data.session.get(memberID)
      return member ? [member] : []
    })
    return sessionSubtree(
      revertedMembers(list, (memberID) => v2.data.session.message.list(memberID)),
      id,
    )
  })

  const labels = createMemo(() =>
    childLabels(members().map((member) => visibleMessages(v2.data.session.message.list(member.id), member.revert))),
  )

  const breakdown = createMemo(() =>
    costBreakdown(members(), labels(), props.sessionID, language.t("context.stats.thisSession")),
  )

  const total = createMemo(() => sumCost(members()))

  const cost = createMemo(() => {
    const value = total()
    if (value === 0) return undefined
    return fmt(value)
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
    const { usage } = sessionUsage(messages(), models(), info()?.model)
    if (!usage) return undefined
    const tokens = usage.tokens.toLocaleString(language.locale())
    const pct = usage.percentage !== null ? `${usage.percentage}%` : undefined
    return { tokens, pct }
  })

  // Subagents run with their own model and reasoning effort, so show them in the header.
  // Subagent viewers are read-only and may not have the child session info loaded.
  const model = createMemo(() => {
    if (!props.readonly && !info()?.parentID) return undefined
    const selection = latestModel(messages()) ?? info()?.model
    if (!selection) return undefined
    const variant = selection.variant === "default" ? undefined : selection.variant
    return { name: modelLabel(selection, models()), variant, id: `${selection.providerID}/${selection.id}` }
  })

  const tokens = createMemo(() => {
    const sum = sumTokens(members())
    return sum.input || sum.output || sum.cache.read
      ? { input: sum.input, output: sum.output, cached: sum.cache.read }
      : undefined
  })

  // Only a session with at least one renderable part shows the strip. The predicate mirrors the timeline filter
  // without building parts or joining tool output.
  const hasTimeline = createMemo(() =>
    messages().some((message) => message.type === "assistant" && message.content.some(renderable)),
  )

  const [expanded, setExpanded] = createSignal(taskTimelineVisible())
  createEffect(on(taskTimelineVisible, (visible) => setExpanded(visible)))

  // The Command Palette toggle and the header search icon both reach the
  // search state from here: the bar itself only mounts once search is active,
  // so it can never be what turns search on in the first place, and it would
  // not exist anymore to react to a request to close it. A nested session
  // view, such as the Agent Manager's sub-agent inspector, opts out so one
  // toggle cannot open search in two views at once.
  const search = useTranscriptSearch()
  const toggleSearch = () => {
    if (!hasMessages()) return
    if (search.active()) search.closeSearch()
    else search.setActive(true)
  }
  if (props.searchCommand !== false) {
    window.addEventListener("focusTranscriptSearch", toggleSearch)
    onCleanup(() => window.removeEventListener("focusTranscriptSearch", toggleSearch))
  }

  // Whenever search closes via an explicit user action — the header toggle
  // button, the Command Palette toggle, the bar's own "X", or Escape — send
  // focus back to the composer rather than leaving it stranded on whatever
  // control was just clicked or removed. `closeSignal` only moves on an
  // explicit close, so a silent reset when the session changes keeps the
  // transcript's own focus handling. `defer: true` skips the initial run so
  // mounting does not immediately steal focus. A read-only view has no
  // composer of its own, so it must not move focus to another surface.
  createEffect(
    on(
      () => search.closeSignal(),
      () => {
        if (!props.readonly) focusPrompt()
      },
      { defer: true },
    ),
  )

  const toggle = () => {
    const next = !expanded()
    setExpanded(next)
    setTaskTimelineVisible(next)
  }

  // The per-model detail is recomputed from the server history, so reverted and finished messages are always
  // reflected. Reads are bounded: 20 pages of 200 messages per member, one member at a time, and the messages are
  // released after their rows are computed.
  const [detailModels, setDetailModels] = createSignal<readonly ModelUsage[]>([])
  const [revision, setRevision] = createSignal(0)
  const synced = new Set<string>()
  let run = 0
  let controller: AbortController | undefined
  let viewed = props.sessionID
  const cancel = () => {
    controller?.abort()
    controller = undefined
  }

  createEffect(
    on(
      () => props.sessionID,
      (id) => {
        if (id === viewed) return
        viewed = id
        synced.clear()
        setDetailModels([])
      },
    ),
  )
  // A finished turn is when the server history can hold new messages. A revert changes the tree without an idle
  // transition, so watch the revert flag of every member too.
  createEffect(
    on(
      () => v2.data.session.status(props.sessionID),
      (status) => {
        if (status === "idle") setRevision((value) => value + 1)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () =>
        members()
          .map((member) => `${member.id}:${member.revert ? "1" : "0"}`)
          .join(","),
      () => setRevision((value) => value + 1),
      { defer: true },
    ),
  )

  // Load the descendants' session infos so the subtree includes nested subagents, not only the members that were
  // already opened. The depth and the visited set stop a cycle or a runaway tree.
  const syncFamily = async (version: number) => {
    let frontier = untrack(() => members().map((member) => member.id))
    const attempted = new Set<string>()
    for (let depth = 0; depth < 4 && frontier.length; depth++) {
      const pending = frontier.filter((id) => !synced.has(id) && !attempted.has(id))
      for (const id of pending) {
        if (version !== run) return
        attempted.add(id)
        await v2.data.session
          .sync(id, { children: true })
          .then(() => synced.add(id))
          .catch(() => {})
      }
      const known = untrack(() => new Set([props.sessionID, ...v2.data.session.family(props.sessionID)]))
      frontier = [...known]
    }
  }

  createEffect(
    on(
      () => [expanded(), props.sessionID, revision()] as const,
      ([open]) => {
        cancel()
        if (!open) return
        const version = ++run
        const next = new AbortController()
        controller = next
        onCleanup(() => next.abort())
        void (async () => {
          await syncFamily(version)
          if (next.signal.aborted || version !== run) return
          const rows: ModelUsage[][] = []
          for (const member of untrack(members)) {
            if (next.signal.aborted || version !== run) return
            const messages = await fetchSessionMessages(v2.api, member.id, next.signal).catch((error: unknown) => {
              // A session created here is not on the server until its create request settles. Skip only that
              // member: the next idle revision loads the usage again.
              if (sessionMissing(error) && v2.data.session.get(member.id)) return undefined
              throw error
            })
            if (next.signal.aborted || version !== run) return
            if (messages) rows.push(modelUsage(visibleMessages(messages, member.revert)).models)
          }
          if (version !== run) return
          setDetailModels(mergeModelUsage(rows))
        })().catch((error: unknown) => {
          if (next.signal.aborted || version !== run) return
          v2.report(error)
        })
      },
    ),
  )
  onCleanup(() => {
    cancel()
    synced.clear()
  })

  const [renaming, setRenaming] = createSignal<{ id: string; title: string }>()

  const startRename = () => {
    if (props.readonly) return
    const current = info()
    if (!current) return
    setRenaming({ id: current.id, title: current.title ?? "" })
  }

  const commitRename = (title: string) => {
    const target = renaming()
    if (!target) return
    setRenaming(undefined)
    if (title === target.title) return
    // Same path as Session History: remember() shows the title at once, the sync reads the new update time.
    void v2.api.session
      .update({ sessionID: target.id, title })
      .then(() => {
        const current = v2.data.session.get(target.id)
        if (current) v2.data.session.remember({ ...current, title })
        v2.data.session.invalidate(target.id)
        return v2.data.session.sync(target.id)
      })
      .catch(v2.report)
  }

  const cancelRename = () => {
    setRenaming(undefined)
  }

  createEffect(() => {
    const target = renaming()
    if (target && props.sessionID !== target.id) setRenaming(undefined)
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
                onClick={() => void v2.data.session.compact({ sessionID: props.sessionID }).catch(v2.report)}
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
          the inline options and doesn't require the timeline to be expanded. */}
      <Show when={search.active()}>
        <div data-component="task-header-search">
          <TranscriptSearchBar />
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
            <TaskTimeline sessionID={props.sessionID} />
          </Show>
          <div data-slot="task-header-graph-row">
            <ContextProgress sessionID={props.sessionID} />
          </div>
          <Show
            when={tokens()}
            fallback={
              <div class="task-header-tokens" aria-hidden="true">
                <Show when={busy()}>
                  <div class="task-header-skeleton" style={{ width: "42px" }} />
                  <div class="task-header-skeleton" style={{ width: "36px" }} />
                  <div class="task-header-skeleton" style={{ width: "28px" }} />
                </Show>
              </div>
            }
          >
            {(tk) => <TaskUsage tokens={tk()} models={detailModels()} providers={providers()} />}
          </Show>
        </div>
      </Show>
    </Show>
  )
}
