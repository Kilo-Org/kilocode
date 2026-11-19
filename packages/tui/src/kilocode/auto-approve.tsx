// `/auto-approve` (aliases `/autoapprove`, `/approve-all`, `/approveall`, `/yolo`) and Ctrl+Alt+A toggle auto-approve
// for this process, the TUI counterpart of the VS Code shield. The prompt metadata row shows "auto" while it is on and
// permission requests stop prompting.
import { dict } from "@kilocode/kilo-i18n/en"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, on } from "solid-js"
import { useConfig } from "../config"
import { usePermission } from "../context/permission"
import { setPermissionMode, togglePermissionMode } from "./permission-mode"

export default Plugin.define({
  id: "kilocode.autoapprove",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        const permission = usePermission()
        const config = useConfig()
        // A settings write means "use this mode", so it clears the runtime override instead of being ignored until the
        // next restart.
        createEffect(
          on(
            () => config.data.session.permissions,
            () => setPermissionMode(undefined),
            { defer: true },
          ),
        )
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
              id: "kilo.autoapprove.toggle",
              title: dict["tui.autoApprove.title"],
              description: dict["tui.autoApprove.description"],
              group: "Session",
              palette: true,
              slash: { name: "auto-approve", aliases: ["autoapprove", "approve-all", "approveall", "yolo"] },
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
