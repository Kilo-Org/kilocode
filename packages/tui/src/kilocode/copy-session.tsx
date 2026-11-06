// `/copy-session` runs the native session transcript copy, so the palette command `session.copy` keeps
// owning the transcript format and its toasts.
import type { Plugin } from "@opencode/plugin/tui"

export function copySession(context: Plugin.Context) {
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
            // The native palette command already covers Ctrl+P; this adds only the slash name, and
            // `session.copy` exists only while a session route is mounted.
            enabled: () => context.ui.router.current().type === "session",
            slash: { name: "copy-session" },
            run: () => context.keymap.dispatch("session.copy"), // kilo_port(unattributed:tui/routes:667ed16d042a)
          },
        ],
      }))
      return null
    },
  })
}
