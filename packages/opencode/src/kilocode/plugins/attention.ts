import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@kilocode/plugin/tui"

const id = "internal:kilo-attention"

function notify(api: TuiPluginApi, sessionID: string, message: string) {
  const session = api.state.session.get(sessionID)
  void api.attention.notify({
    title: session?.title,
    message,
    notification: session?.parentID ? false : { when: "blurred" },
    sound: { name: "question", when: "always" },
  })
}

const tui: TuiPlugin = async (api) => {
  const suggestions = new Set<string>()
  const network = new Set<string>()

  api.event.on("suggestion.shown", (event) => {
    if (suggestions.has(event.properties.id)) return
    suggestions.add(event.properties.id)
    notify(api, event.properties.sessionID, "Suggestion needs input")
  })

  api.event.on("suggestion.accepted", (event) => {
    suggestions.delete(event.properties.requestID)
  })

  api.event.on("suggestion.dismissed", (event) => {
    suggestions.delete(event.properties.requestID)
  })

  api.event.on("session.network.asked", (event) => {
    if (network.has(event.properties.id)) return
    network.add(event.properties.id)
    notify(api, event.properties.sessionID, "Network connection needs input")
  })

  api.event.on("session.network.replied", (event) => {
    network.delete(event.properties.requestID)
  })

  api.event.on("session.network.rejected", (event) => {
    network.delete(event.properties.requestID)
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
