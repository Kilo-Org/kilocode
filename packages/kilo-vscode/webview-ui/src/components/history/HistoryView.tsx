/**
 * HistoryView component
 * Unified panel for local and cloud session history.
 * Contains a tab bar ("Local" | "Cloud") and an always-visible "Import session" button.
 */

import { Component, createEffect, createSignal, onCleanup } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"
import { useLocalTabs } from "../../context/local-tabs"
import { CloudImportDialog } from "../chat/CloudImportDialog"
import SessionList from "./SessionList"
import CloudSessionList from "./CloudSessionList"

interface HistoryViewProps {
  onSelectSession: (id: string) => void
  onBack?: () => void
}

const HistoryView: Component<HistoryViewProps> = (props) => {
  const language = useLanguage()
  const dialog = useDialog()
  const session = useSession()
  const tabs = useLocalTabs()
  const [tab, setTab] = createSignal<"local" | "cloud">("local")
  let local: HTMLButtonElement | undefined
  let cloud: HTMLButtonElement | undefined
  let localPanel: HTMLDivElement | undefined
  let cloudPanel: HTMLDivElement | undefined

  createEffect(() => {
    const panel = tab() === "local" ? localPanel : cloudPanel

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

  function move(event: KeyboardEvent, current: "local" | "cloud") {
    const next =
      event.key === "Home"
        ? local
        : event.key === "End"
          ? cloud
          : event.key === "ArrowLeft" || event.key === "ArrowRight"
            ? current === "local"
              ? cloud
              : local
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
        {tab() === "local" && <SessionList onSelectSession={props.onSelectSession} />}
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
    </div>
  )
}

export default HistoryView
