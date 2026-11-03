// The Agent Manager session history: the sessions of the project, with a Worktree tab when the project has worktree
// sessions. Each row renames and deletes through the store of the session's directory.
import { Button } from "@kilocode/kilo-ui/button"
import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { useLanguage } from "../src/context/language"
import type { V2 } from "../src/v2/client"
import { SessionList } from "../src/v2/history"
import type { SessionInfo } from "../src/types/messages/agent-manager"
import { historyTabTarget, type HistorySource } from "./history-tabs"

type Source = HistorySource

export default function HistoryView(props: {
  sessions: () => SessionInfo[]
  /** Limits the Local tab to these sessions. */
  sessionIds?: () => ReadonlySet<string> | undefined
  /** The worktree sessions; the Worktree tab shows while set. */
  worktreeSessionIds?: () => ReadonlySet<string> | undefined
  store: (id: string) => V2 | undefined
  onSelectSession: (id: string) => void
  onBack: () => void
  /** Extra row actions of the Local tab. */
  rowActions?: (session: SessionInfo) => JSX.Element
}) {
  const language = useLanguage()
  const [tab, setTab] = createSignal<Source>(props.worktreeSessionIds?.() ? "worktree" : "local")
  const panels: Partial<Record<Source, HTMLDivElement>> = {}
  const tabs: Partial<Record<Source, HTMLButtonElement>> = {}
  const sources = (): Source[] => (props.worktreeSessionIds?.() ? ["local", "worktree"] : ["local"])
  const move = (event: KeyboardEvent, current: Source) => {
    const next = historyTabTarget(sources(), current, event.key)
    if (!next) return
    event.preventDefault()
    tabs[next]?.focus()
  }
  const within = (ids: ReadonlySet<string> | undefined) => () =>
    ids ? props.sessions().filter((item) => ids.has(item.id)) : props.sessions()

  createEffect(() => {
    if (tab() === "worktree" && !props.worktreeSessionIds?.()) setTab("local")
  })
  // Focus the search field of the shown list, as the sidebar history does.
  createEffect(() => {
    const panel = panels[tab()]
    const frame = requestAnimationFrame(() =>
      panel?.querySelector<HTMLInputElement>('[data-slot="list-search"] input')?.focus(),
    )
    onCleanup(() => cancelAnimationFrame(frame))
  })

  const button = (source: Source, label: string) => (
    <button
      id={`history-tab-${source}`}
      class="history-tab-btn"
      classList={{ "history-tab-btn--active": tab() === source }}
      type="button"
      role="tab"
      aria-selected={tab() === source}
      aria-controls={`history-panel-${source}`}
      tabIndex={tab() === source ? 0 : -1}
      ref={(element) => (tabs[source] = element)}
      onClick={() => setTab(source)}
      onKeyDown={(event) => move(event, source)}
    >
      {label}
    </button>
  )

  const panel = (source: Source, list: () => JSX.Element) => (
    <div
      class="history-view-content"
      ref={(element) => (panels[source] = element)}
      id={`history-panel-${source}`}
      role="tabpanel"
      aria-labelledby={`history-tab-${source}`}
      hidden={tab() !== source}
    >
      <Show when={tab() === source}>{list()}</Show>
    </div>
  )

  return (
    <div class="history-view">
      <div class="history-view-header">
        <Button variant="ghost" size="small" icon="arrow-left" onClick={props.onBack}>
          {language.t("common.goBack")}
        </Button>
        <div class="history-view-tabs" role="tablist" aria-label={language.t("session.history.sources")}>
          {button("local", language.t("session.tab.local"))}
          <Show when={props.worktreeSessionIds?.()}>{button("worktree", language.t("session.tab.worktree"))}</Show>
        </div>
      </div>
      {panel("local", () => (
        <SessionList
          onOpen={props.onSelectSession}
          sessions={() => within(props.sessionIds?.())()}
          store={props.store}
          rowActions={props.rowActions}
        />
      ))}
      <Show when={props.worktreeSessionIds?.()}>
        {(ids) =>
          panel("worktree", () => (
            <SessionList onOpen={props.onSelectSession} sessions={within(ids())} store={props.store} />
          ))
        }
      </Show>
    </div>
  )
}
