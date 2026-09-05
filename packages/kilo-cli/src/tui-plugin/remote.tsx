import type { createClient } from "@kilocode/client"
import type { Plugin } from "@opencode-ai/plugin/tui"
import { REMOTE_LIMITATION, RemoteRpc } from "../remote-rpc"

export function installRemoteUi(
  ctx: Plugin.Context,
  options: {
    readonly client?: Pick<ReturnType<typeof createClient>, "rpc">
    readonly signal?: AbortSignal
  },
) {
  const rpc = options.client?.rpc(RemoteRpc)
  ctx.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "kilo.remote",
        title: "Remote control (preview)",
        description: "Manage the limited, opt-in remote control adapter",
        group: "Kilo",
        palette: true,
        suggested: false,
        slash: { name: "remote" },
        run: async () => {
          if (options.signal?.aborted) return
          if (!rpc)
            return ctx.ui.toast.show({ message: "Remote controls are unavailable in this host", variant: "error" })
          const location = ctx.location ?? ctx.data.location.default()
          const request = {
            signal: options.signal,
            location: {
              directory: location.directory,
              ...(location.workspaceID === undefined ? {} : { workspace: location.workspaceID }),
            },
          }
          try {
            const status = await rpc.status({}, request)
            const action = await ctx.ui.dialog.select({
              title: `Remote control · ${status.connected ? "Connected" : status.enabled ? "Enabled, disconnected" : "Disabled"}`,
              placeholder: "Choose a remote action",
              options: [
                {
                  title: status.enabled ? "Disable remote" : "Enable remote",
                  value: status.enabled ? "disable" : "enable",
                  description: ctx.ui.format.path(status.directory),
                },
                { title: "Preview limitations", value: "limits", description: "Not full remote conversation parity" },
              ],
            })
            if (action === undefined || options.signal?.aborted) return
            if (action === "limits")
              return ctx.ui.dialog.alert({ title: "Remote preview limitations", message: REMOTE_LIMITATION })
            if (action === "enable") {
              const confirmed = await ctx.ui.dialog.confirm({
                title: "Enable remote control?",
                message: `${REMOTE_LIMITATION}\n\nLocation: ${ctx.ui.format.path(status.directory)}`,
                label: { confirm: "Enable", cancel: "Cancel" },
              })
              if (confirmed !== true || options.signal?.aborted) return
              await rpc.enable({}, request)
            }
            if (action === "disable") await rpc.disable({}, request)
            ctx.ui.toast.show({
              message: action === "enable" ? "Remote enabled; connection may still be opening" : "Remote disabled",
              variant: "info",
            })
          } catch {
            if (!options.signal?.aborted)
              ctx.ui.toast.show({
                message: "Remote operation failed. Check the Kilo account and host configuration.",
                variant: "error",
              })
          }
        },
      },
    ],
  }))
}
