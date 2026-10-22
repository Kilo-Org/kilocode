import { createEffect, onCleanup } from "solid-js"
import * as Log from "@opencode-ai/core/util/log"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { Event as IndexingStatusEvent, Warning as IndexingWarningEvent } from "@/kilocode/indexing-event"
import { indexingErrorMessage, indexingWarningKey, type IndexingWarning } from "@/kilocode/indexing-warning"

const log = Log.create({ service: "indexing-warning" })

export function useIndexingWarnings() {
  const sdk = useSDK()
  const toast = useToast()
  const project = useProject()
  const seen = new Set<string>()
  const state = { scope: "" }
  const show = (warning: IndexingWarning) => {
    const key = indexingWarningKey(warning)
    if (seen.has(key)) return
    seen.add(key)
    toast.show({
      title: "Qdrant Compatibility Warning",
      message: warning.message,
      variant: "warning",
      duration: 10000,
    })
  }
  const showError = (message: string) => {
    const key = `error\u0000${message}`
    if (seen.has(key)) return
    seen.add(key)
    toast.show({
      title: "Code Indexing Error",
      message,
      variant: "error",
      duration: 10000,
    })
  }

  onCleanup(
    sdk.event.on("event", (event) => {
      if (event.payload.type !== IndexingWarningEvent.type && event.payload.type !== IndexingStatusEvent.type) return
      if (event.workspace !== project.workspace.current()) return
      const directory = project.instance.directory() || sdk.directory
      if (directory && event.directory !== directory) return
      if (event.payload.type === IndexingWarningEvent.type) {
        show(event.payload.properties)
        return
      }
      const message = indexingErrorMessage(event.payload.properties.status)
      if (message) showError(message)
    }),
  )
  createEffect(() => {
    const workspace = project.workspace.current()
    const directory = project.instance.directory() || sdk.directory || ""
    const scope = `${workspace ?? ""}\u0000${directory}`
    if (state.scope !== scope) {
      state.scope = scope
      seen.clear()
    }
    void Promise.all([
      sdk.client.indexing.warnings({ workspace }, { throwOnError: true }),
      sdk.client.indexing.status({ workspace }, { throwOnError: true }),
    ])
      .then(([warnings, status]) => {
        if (project.workspace.current() !== workspace) return
        if ((project.instance.directory() || sdk.directory || "") !== directory) return
        for (const warning of warnings.data ?? []) show(warning)
        const message = status.data ? indexingErrorMessage(status.data) : undefined
        if (message) showError(message)
      })
      .catch((err) => log.debug("indexing notification replay failed", { err }))
  })
}
