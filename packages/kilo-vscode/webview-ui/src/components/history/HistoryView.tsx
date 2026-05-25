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
  const [tab, setTab] = createSignal<"local" | "cloud">("local")
  let content: HTMLDivElement | undefined

  createEffect(() => {
    tab()

    const frame = requestAnimationFrame(() => {
      content
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
    session.selectCloudSession(id)
    props.onBack?.()
  }

  return (
    <div class="history-view">
      <div class="history-view-header">
        <Button variant="ghost" size="small" icon="arrow-left" onClick={() => props.onBack?.()}>
          {language.t("common.goBack")}
        </Button>
        <div class="history-view-tabs">
          <button
            class="history-tab-btn"
            classList={{ "history-tab-btn--active": tab() === "local" }}
            onClick={() => setTab("local")}
          >
            {language.t("session.tab.local")}
          </button>
          <button
            class="history-tab-btn"
            classList={{ "history-tab-btn--active": tab() === "cloud" }}
            onClick={() => setTab("cloud")}
          >
            {language.t("session.tab.cloud")}
          </button>
        </div>
        <Button variant="secondary" size="small" onClick={openImport} class="history-import-btn">
          {language.t("session.cloud.import")}
        </Button>
      </div>

      <div class="history-view-content" ref={content}>
        {tab() === "local" ? (
          <SessionList onSelectSession={props.onSelectSession} />
        ) : (
          <CloudSessionList onSelectSession={selectCloudSession} />
        )}
      </div>
    </div>
  )
}

export default HistoryView
