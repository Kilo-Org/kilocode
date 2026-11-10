// A subagent editor tab: one child session, read-only, with live updates from the shared event stream. The host
// inlines the target; the webview state keeps it so the tab restores after a window reload. Going back closes the
// tab and shows the parent session in the sidebar.
import { Button } from "@kilocode/kilo-ui/button"
import type { ToolActions } from "@kilocode/kilo-ui/message-part"
import { createEffect, on, Show } from "solid-js"
import type { SubagentTarget, ToHost } from "../../../src/protocol"
import { useLanguage } from "../context/language"
import { getVSCodeAPI } from "../context/vscode"
import { useV2 } from "./client"
import { openSubagent } from "./open-subagent"
import { SessionView } from "./session-view"

export function SubagentViewer() {
  const v2 = useV2()
  const language = useLanguage()
  const api = getVSCodeAPI()
  const target = (window as unknown as { KILO_SUBAGENT?: SubagentTarget & { directory: string } }).KILO_SUBAGENT
  api.setState({ ...(api.getState() as Record<string, unknown> | undefined), subagent: target })
  const post = (message: ToHost) => api.postMessage(message as never)
  const parent = () => target?.parentSessionID

  createEffect(
    on(v2.connection.status, (status) => {
      const id = parent()
      if (status === "connected" && id && !v2.data.session.get(id)) void v2.data.session.sync(id).catch(() => undefined)
    }),
  )

  const actions: ToolActions = {
    openFile: (filePath, line, column, sessionID) =>
      post({ type: "openToolFile", filePath, line, column, sessionID: sessionID ?? target?.sessionID }),
    openDiff: (diff) => post({ type: "openDiffVirtual", diff }),
    openDiffs: (diffs) => post({ type: "openDiffsVirtual", diffs }),
    subagentTarget: "tab",
    openSubagent: (sessionID, title) =>
      openSubagent({ sessionID, title, parentSessionID: target?.sessionID, surface: "tab", post }),
  }

  return (
    <div class="subagent-viewer">
      <Show when={parent()}>
        {(id) => (
          <div class="history-view-header">
            <Button variant="ghost" size="small" icon="arrow-left" onClick={() => post({ type: "subagentBack" })}>
              {v2.data.session.get(id())?.title || language.t("common.goBack")}
            </Button>
          </div>
        )}
      </Show>
      <SessionView
        session={target?.sessionID}
        onSession={() => undefined}
        actions={actions}
        onShowHistory={() => undefined}
        readOnly
      />
    </div>
  )
}
