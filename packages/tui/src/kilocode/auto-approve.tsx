// `/yolo` and Ctrl+Alt+A toggle auto-approve for this process, the TUI counterpart of the VS Code shield. The prompt
// metadata row shows "auto" while it is on and permission requests stop prompting.
import { dict } from "@kilocode/kilo-i18n/en"
import { Plugin } from "@opencode/plugin/tui"
import { usePermission } from "../context/permission"
import { togglePermissionMode } from "./permission-mode"

export default Plugin.define({
  id: "kilocode.autoapprove",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        const permission = usePermission()
        const toggle = () => {
          const next = togglePermissionMode(permission.mode)
          context.ui.toast.show({
            variant: "info",
            message: dict[next === "autoaccept" ? "tui.autoApprove.enabled" : "tui.autoApprove.disabled"],
          })
        }
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "kilocode.autoapprove.toggle",
              title: dict["tui.autoApprove.title"],
              description: dict["tui.autoApprove.description"],
              group: "Session",
              palette: true,
              slash: { name: "yolo" },
              bind: "ctrl+alt+a",
              run: toggle,
            },
          ],
        }))
        return null
      },
    })
  },
})
