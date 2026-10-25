/**
 * HistoryView component
 * Unified panel for local, cloud, and optional worktree session history.
 * Contains a source tab bar and an always-visible "Import session" button.
 */

import { Component, Show, createEffect, createSignal, onCleanup, type Accessor, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useLocalTabs } from "../../context/local-tabs"
import { useConfig } from "../../context/config"
import { CloudImportDialog } from "../chat/CloudImportDialog"
import SessionList from "./SessionList"
import CloudSessionList from "./CloudSessionList"
import HostedSessionList from "./HostedSessionList"
import type { SessionInfo } from "../../types/messages"

interface HistoryViewProps {
  onSelectSession: (id: string) => void
  onBack?: () => void
  worktreeSessionIds?: Accessor<ReadonlySet<string> | undefined>
  /** Filter the Local tab to these session ids. */
  sessionIds?: Accessor<ReadonlySet<string> | undefined>
  /** Extra per-row actions rendered in the Local tab. */
  rowActions?: (session: SessionInfo) => JSX.Element
}

type Source = "local" | "cloud" | "hosted" | "worktree"

const EMPTY_SESSION_IDS = new Set<string>()

const HistoryView: Component<HistoryViewProps> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const session = useSession()
  const tabs = useLocalTabs()
  const config = useConfig()
  const worktreeIds = () => props.worktreeSessionIds?.()
  const hosted = () => config.settings().hostedSessions === true
  const [tab, setTab] = createSignal<Source>(worktreeIds() ? "worktree" : "local")
  let local: HTMLButtonElement | undefined
  let cloud: HTMLButtonElement | undefined
  let hostedTab: HTMLButtonElement | undefined
  let worktree: HTMLButtonElement | undefined
  let localPanel: HTMLDivElement | undefined
  let cloudPanel: HTMLDivElement | undefined
  let hostedPanel: HTMLDivElement | undefined
  let worktreePanel: HTMLDivElement | undefined

  createEffect(() => {
    if (tab() === "worktree" && !worktreeIds()) setTab("local")
    if (tab() === "hosted" && !hosted()) setTab("local")
  })

  createEffect(() => {
    const panel =
      tab() === "local" ? localPanel : tab() === "cloud" ? cloudPanel : tab() === "hosted" ? hostedPanel : worktreePanel

    const frame = requestAnimationFrame(() => {
      panel
        ?.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >('[data-slot="list-search"] input, [data-slot="list-search"] textarea')
        ?.focus()
    })

    onCleanup(() => cancelAnimationFrame(frame))
  })

  function openImport() {
    dialog.show(() => (
      <CloudImportDialog
        onImport={(id) => {
          selectCloudSession(id)
        }}
      />
    ))
  }

  function selectCloudSession(id: string) {
    tabs?.previewCloud(id)
    session.selectCloudSession(id)
    props.onBack?.()
  }

  function move(event: KeyboardEvent, current: Source) {
    const sources: Source[] = [
      "local",
      "cloud",
      ...(hosted() ? (["hosted"] as Source[]) : []),
      ...(worktreeIds() ? (["worktree"] as Source[]) : []),
    ]
    const index = sources.indexOf(current)
    const source =
      event.key === "Home"
        ? sources[0]
        : event.key === "End"
          ? sources.at(-1)
          : event.key === "ArrowLeft"
            ? sources[(index - 1 + sources.length) % sources.length]
            : event.key === "ArrowRight"
              ? sources[(index + 1) % sources.length]
              : undefined
    const next =
      source === "local"
        ? local
        : source === "cloud"
          ? cloud
          : source === "hosted"
            ? hostedTab
            : source === "worktree"
              ? worktree
              : undefined
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  return (
    <div class="history-view">
      <div class="history-view-header">
        <Button variant="ghost" size="small" icon="arrow-left" onClick={() => props.onBack?.()}>
          {language.t("common.goBack")}
        </Button>
        <div class="history-view-tabs" role="tablist" aria-label={language.t("session.history.sources")}>
          <button
            ref={local}
            id="history-tab-local"
            class="history-tab-btn"
            classList={{ "history-tab-btn--active": tab() === "local" }}
            type="button"
            role="tab"
            aria-selected={tab() === "local"}
            aria-controls="history-panel-local"
            tabIndex={tab() === "local" ? 0 : -1}
            onClick={() => setTab("local")}
            onKeyDown={(event) => move(event, "local")}
          >
            {language.t("session.tab.local")}
          </button>
          <button
            ref={cloud}
            id="history-tab-cloud"
            class="history-tab-btn"
            classList={{ "history-tab-btn--active": tab() === "cloud" }}
            type="button"
            role="tab"
            aria-selected={tab() === "cloud"}
            aria-controls="history-panel-cloud"
            tabIndex={tab() === "cloud" ? 0 : -1}
            onClick={() => setTab("cloud")}
            onKeyDown={(event) => move(event, "cloud")}
          >
            {language.t("session.tab.cloud")}
          </button>
          <Show when={hosted()}>
            <button
              ref={hostedTab}
              id="history-tab-hosted"
              class="history-tab-btn"
              classList={{ "history-tab-btn--active": tab() === "hosted" }}
              type="button"
              role="tab"
              aria-selected={tab() === "hosted"}
              aria-controls="history-panel-hosted"
              tabIndex={tab() === "hosted" ? 0 : -1}
              onClick={() => setTab("hosted")}
              onKeyDown={(event) => move(event, "hosted")}
            >
              {language.t("session.tab.hosted")}
            </button>
          </Show>
          <Show when={worktreeIds()}>
            <button
              ref={worktree}
              id="history-tab-worktree"
              class="history-tab-btn"
              classList={{ "history-tab-btn--active": tab() === "worktree" }}
              type="button"
              role="tab"
              aria-selected={tab() === "worktree"}
              aria-controls="history-panel-worktree"
              tabIndex={tab() === "worktree" ? 0 : -1}
              onClick={() => setTab("worktree")}
              onKeyDown={(event) => move(event, "worktree")}
            >
              {language.t("session.tab.worktree")}
            </button>
          </Show>
        </div>
        <Button variant="secondary" size="small" onClick={openImport} class="history-import-btn">
          {language.t("session.cloud.import")}
        </Button>
      </div>

      <div
        class="history-view-content"
        ref={localPanel}
        id="history-panel-local"
        role="tabpanel"
        aria-labelledby="history-tab-local"
        hidden={tab() !== "local"}
      >
        {tab() === "local" && (
          <SessionList
            onSelectSession={props.onSelectSession}
            sessionIds={props.sessionIds}
            rowActions={props.rowActions}
          />
        )}
      </div>
      <div
        class="history-view-content"
        ref={cloudPanel}
        id="history-panel-cloud"
        role="tabpanel"
        aria-labelledby="history-tab-cloud"
        hidden={tab() !== "cloud"}
      >
        {tab() === "cloud" && <CloudSessionList onSelectSession={selectCloudSession} />}
      </div>
      <Show when={hosted()}>
        <div
          class="history-view-content"
          ref={hostedPanel}
          id="history-panel-hosted"
          role="tabpanel"
          aria-labelledby="history-tab-hosted"
          hidden={tab() !== "hosted"}
        >
          {tab() === "hosted" && (
            <HostedSessionList
              onSelectSession={(entry) => {
                session.selectHostedSession(entry.providerID, entry.sessionID)
                // Open it as a tab so the session stays "open" host-side while
                // the user works in it, and closes (detaching) like any tab.
                tabs?.openHosted(entry.key)
                props.onBack?.()
              }}
            />
          )}
        </div>
      </Show>
      <Show when={worktreeIds()}>
        <div
          class="history-view-content"
          ref={worktreePanel}
          id="history-panel-worktree"
          role="tabpanel"
          aria-labelledby="history-tab-worktree"
          hidden={tab() !== "worktree"}
        >
          {tab() === "worktree" && (
            <SessionList
              onSelectSession={props.onSelectSession}
              sessionIds={() => worktreeIds() ?? EMPTY_SESSION_IDS}
            />
          )}
        </div>
      </Show>
    </div>
  )
}

export default HistoryView
