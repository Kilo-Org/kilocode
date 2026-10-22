/** Local session history. */
import { Component, onMount, type Accessor, type JSX } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { useLanguage } from "../../context/language"
import SessionList from "./SessionList"
import type { SessionInfo } from "../../types/messages"

interface HistoryViewProps {
  onSelectSession: (id: string) => void
  onBack?: () => void
  sessionIds?: Accessor<ReadonlySet<string> | undefined>
  rowActions?: (session: SessionInfo) => JSX.Element
}

const HistoryView: Component<HistoryViewProps> = (props) => {
  const language = useLanguage()
  let localPanel: HTMLDivElement | undefined
  onMount(() => {
    localPanel
      ?.querySelector<
        HTMLInputElement | HTMLTextAreaElement
      >('[data-slot="list-search"] input, [data-slot="list-search"] textarea')
      ?.focus()
  })

  return (
    <div class="history-view">
      <div class="history-view-header">
        <Button variant="ghost" size="small" icon="arrow-left" onClick={() => props.onBack?.()}>
          {language.t("common.goBack")}
        </Button>
        <div class="history-view-tabs" role="tablist" aria-label={language.t("session.history.sources")}>
          <button
            id="history-tab-local"
            class="history-tab-btn history-tab-btn--active"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="history-panel-local"
          >
            {language.t("session.tab.local")}
          </button>
        </div>
      </div>
      <div
        class="history-view-content"
        ref={localPanel}
        id="history-panel-local"
        role="tabpanel"
        aria-labelledby="history-tab-local"
      >
        <SessionList
          onSelectSession={props.onSelectSession}
          sessionIds={props.sessionIds}
          rowActions={props.rowActions}
        />
      </div>
    </div>
  )
}

export default HistoryView
