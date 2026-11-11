import type { Plugin } from "@opencode/plugin/tui"
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"

function warningKey(warning: KiloIndexingRpc.Warning) {
  return `${warning.code}\u0000${warning.message}`
}

function errorMessage(status: KiloIndexingRpc.Status) {
  return status.state === "Error" ? status.message : undefined
}

export function watchIndexingWarnings(context: Plugin.Context) {
  const rpc = context.client.rpc(KiloIndexingRpc.Definition)
  const directory = (context.location ?? context.data.location.default()).directory
  const options = { location: { directory } }
  const seen = new Set<string>()
  const show = (warning: KiloIndexingRpc.Warning) => {
    const key = warningKey(warning)
    if (seen.has(key)) return
    seen.add(key)
    context.ui.toast.show({
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
    context.ui.toast.show({
      title: "Code Indexing Error",
      message,
      variant: "error",
      duration: 10000,
    })
  }

  const stopWarning = rpc.events.on("warning", (event) => {
    if (event.location.directory !== directory) return
    show(event.data)
  })
  const stopStatus = rpc.events.on("status", (event) => {
    if (event.location.directory !== directory) return
    const message = errorMessage(event.data.status)
    if (message) showError(message)
  })

  void Promise.all([rpc.warnings({}, options), rpc.status({}, options)])
    .then(([warnings, status]) => {
      for (const warning of warnings) show(warning)
      const message = errorMessage(status)
      if (message) showError(message)
    })
    .catch(() => undefined)

  return () => {
    stopWarning()
    stopStatus()
  }
}
