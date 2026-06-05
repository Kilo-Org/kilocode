import { createEffect, onCleanup } from "solid-js"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { Warning as IndexingWarningEvent } from "@/kilocode/indexing-event"
import { indexingWarningKey, type IndexingWarning } from "@/kilocode/indexing-warning"

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

  onCleanup(
    sdk.event.on("event", (event) => {
      if (event.payload.type !== IndexingWarningEvent.type) return
      if (event.workspace !== undefined && event.workspace !== project.workspace.current()) return
      const directory = project.instance.directory() || sdk.directory
      if (directory && event.directory !== directory) return
      show(event.payload.properties)
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
    void sdk.client.indexing
      .warnings({ workspace })
      .then((response) => {
        if (project.workspace.current() !== workspace) return
        if ((project.instance.directory() || sdk.directory || "") !== directory) return
        for (const warning of response.data ?? []) show(warning)
      })
      .catch(() => undefined)
  })
}
