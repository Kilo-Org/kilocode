// `/copy-session` runs the native session transcript copy, so the palette command `session.copy` keeps
// owning the transcript format and its toasts.
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "kilocode.copy-session",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "kilo.copy-session",
              title: "Copy session transcript",
              description: "Copy the whole session transcript to the clipboard",
              group: "Kilo",
              palette: true,
              slash: { name: "copy-session" },
              run: () => context.keymap.dispatch("session.copy"), // kilo_port(unattributed:tui/routes:667ed16d042a)
            },
          ],
        }))
        return null
      },
    })
  },
})
