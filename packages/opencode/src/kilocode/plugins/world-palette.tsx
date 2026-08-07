import type { Config } from "@kilocode/sdk/v2"
import type { TuiPlugin } from "@kilocode/plugin/tui"
import { defaultConfig, hasDisplay } from "@kilocode/world/client"
import type { InternalTuiPlugin } from "@/plugin/tui/internal"
import { errorMessage } from "@/util/error"

const id = "internal:kilo-world-palette"

type Option = {
  name: string
  slash: string
  fallback: boolean
  read: (cfg: Config) => boolean | undefined
  patch: (value: boolean) => Config
  title: string
  toast: (value: boolean) => string
  error: string
  hidden?: boolean
  check?: (value: boolean) => string | undefined
}

const tui: TuiPlugin = async (api) => {
  const command = (opt: Option) => ({
    namespace: "palette",
    name: opt.name,
    slashName: opt.slash,
    category: "System",
    get hidden() {
      return opt.hidden && api.state.config.experimental?.world_browser === false
    },
    title: opt.title,
    async run() {
      try {
        const response = await api.client.global.config.get({})
        if (response.error) {
          api.ui.toast({
            message: `${opt.error}: ${errorMessage(response.error)}`,
            variant: "error",
            duration: 5000,
          })
          return
        }
        const current = opt.read(response.data ?? {}) ?? opt.fallback
        const next = !current
        const issue = opt.check?.(next)
        if (issue) {
          api.ui.toast({ message: issue, variant: "error", duration: 5000 })
          return
        }
        const result = await api.client.global.config.update({ config: opt.patch(next) })
        if (result.error) {
          api.ui.toast({
            message: `${opt.error}: ${errorMessage(result.error)}`,
            variant: "error",
            duration: 5000,
          })
          return
        }
        api.ui.toast({ message: opt.toast(next), variant: "success" })
        api.ui.dialog.clear()
      } catch (err) {
        api.ui.toast({ message: `${opt.error}: ${errorMessage(err)}`, variant: "error", duration: 5000 })
      }
    },
  })

  api.keymap.registerLayer({
    commands: [
      command({
        name: "world.toggle",
        slash: "world",
        fallback: true,
        read: (cfg) => cfg.experimental?.world_browser,
        patch: (value) => ({ experimental: { world_browser: value } }),
        title: "Toggle Global World (Browser Use)",
        toast: (value) => `Global World preference set to ${value ? "enabled" : "disabled"}`,
        error: "Failed to toggle World",
      }),
      command({
        name: "world.headless",
        slash: "world-headless",
        fallback: defaultConfig().browser.headless,
        read: (cfg) => cfg.world?.browser?.headless,
        patch: (value) => ({ world: { browser: { headless: value } } }),
        title: "Toggle Global World Headless Mode",
        toast: (value) =>
          `Global World browser preference set to ${value ? "headless" : "a visible window"}; project configuration takes precedence when present`,
        error: "Failed to toggle World browser mode",
        hidden: true,
        check: (value) =>
          !value && !hasDisplay() ? "Cannot show the World browser because no display server is available" : undefined,
      }),
      command({
        name: "world.chrome",
        slash: "world-chrome",
        fallback: false,
        read: (cfg) => cfg.world?.browser?.use_system_chrome,
        patch: (value) => ({ world: { browser: { use_system_chrome: value } } }),
        title: "Toggle Global World Browser Source",
        toast: (value) =>
          `Global World browser preference set to ${value ? "prefer system Chrome when installed" : "bundled Chromium"}; project configuration takes precedence when present`,
        error: "Failed to change World browser",
        hidden: true,
      }),
    ],
    bindings: [],
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
