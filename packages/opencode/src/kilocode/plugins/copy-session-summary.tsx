import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"
import * as Clipboard from "@tui/util/clipboard"
import { DialogSummaryGenerating } from "@/kilocode/tui/dialog-summary-generating"
import { DialogSummaryResult } from "@/kilocode/tui/dialog-summary-result"

const id = "internal:kilo-copy-session-summary"

function resolveModel(api: TuiPluginApi): { providerID: string; modelID: string } | undefined {
  const route = api.route.current
  const sessionID =
    route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
  if (!sessionID) return undefined
  const messages = api.state.session.messages(sessionID)
  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  if (lastUser?.model?.providerID && lastUser.model.modelID) {
    return { providerID: lastUser.model.providerID, modelID: lastUser.model.modelID }
  }
  const providers = api.state.provider
  for (const provider of providers) {
    const ids = Object.keys(provider.models ?? {})
    if (ids.length === 0) continue
    return { providerID: provider.id, modelID: ids[0] }
  }
  return undefined
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "session.copy.summary",
        title: "Copy session summary",
        category: "Session",
        namespace: "palette",
        slashName: "copy-summary",
        hidden: () => api.route.current.name !== "session",
        enabled: () => api.route.current.name === "session",
        async run() {
          const route = api.route.current
          if (route.name !== "session") return
          const sessionID = typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined
          if (!sessionID) return
          const model = resolveModel(api)
          if (!model) {
            api.ui.toast({
              variant: "warning",
              message: "Connect a provider to summarize this session",
              duration: 3000,
            })
            return
          }
          api.ui.dialog.setSize("medium")
          api.ui.dialog.replace(() => <DialogSummaryGenerating />)
          try {
            const res = await api.client.session.summary({
              sessionID,
              providerID: model.providerID,
              modelID: model.modelID,
            })
            if (res.error) {
              const message =
                res.error && typeof res.error === "object" && "message" in res.error
                  ? String((res.error as { message: unknown }).message)
                  : "Failed to generate session summary"
              api.ui.toast({ variant: "error", message })
              api.ui.dialog.clear()
              return
            }
            const text = (res.data ?? "") as string
            if (!text.trim()) {
              api.ui.toast({
                variant: "info",
                message: "Nothing to summarize yet — send a message and try again",
                duration: 3000,
              })
              api.ui.dialog.clear()
              return
            }
            let copied = false
            try {
              await Clipboard.copy(text)
              copied = true
            } catch {
              copied = false
            }
            api.ui.dialog.setSize("large")
            api.ui.dialog.replace(() => (
              <DialogSummaryResult text={text} sessionID={sessionID} copied={copied} />
            ))
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return
            api.ui.toast({
              variant: "error",
              message: err instanceof Error ? err.message : "Failed to generate session summary",
            })
            api.ui.dialog.clear()
          }
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("session.copy.summary", ["session.copy.summary"]),
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
