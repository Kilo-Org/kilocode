import type { TuiPlugin, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { KiloNews } from "@/kilocode/components/kilo-news"

const id = "internal:home-news"

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: "news.toggle",
        get title() {
          return api.kv.get("news_hidden", false) ? "Show news" : "Hide news"
        },
        category: "System",
        get hidden() {
          return api.route.current.name !== "home"
        },
        run() {
          api.kv.set("news_hidden", !api.kv.get("news_hidden", false))
          api.ui.dialog.clear()
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("home.news", ["news.toggle"]),
  })

  api.slots.register({
    order: 50,
    slots: {
      home_bottom() {
        const hidden = createMemo(() => api.kv.get("news_hidden", false))
        return (
          <box width="100%" maxWidth={75} alignItems="center" paddingTop={2}>
            <Show when={!hidden()}>
              <KiloNews />
            </Show>
          </box>
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
