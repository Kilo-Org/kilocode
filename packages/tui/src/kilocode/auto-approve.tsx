// `/auto-approve` (aliases `/autoapprove`, `/approve-all`, `/approveall`, `/yolo`) and Ctrl+Alt+A toggle the saved
// global auto-approve rule, the TUI counterpart of the VS Code shield and of v1's saved command. The rule lives in the
// global config, so every client stops prompting and the next TUI run restores it. The prompt metadata row shows
// "auto" while it is on.
import { dict } from "@kilocode/kilo-i18n/en"
import { Plugin } from "@opencode/plugin/tui"
import { KiloAutoApproveRpc } from "@opencode/schema/kilocode/auto-approve"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { createEffect, createRoot, createSignal, on, onCleanup } from "solid-js"
import { useConfig } from "../config"
import { useArgs } from "../context/args"
import { usePermission, type PermissionMode } from "../context/permission"
import { isRecord } from "../util/record"
import { nextPermissionMode, permissionModeOverride, setPermissionMode } from "./permission-mode"

export type ServerAutoApproveState = KiloAutoApproveRpc.State

/** The location the Kilo RPCs answer for: the TUI's own project, the same one every other Kilo command reads. */
const located = (context: Plugin.Context) => ({
  location: context.location ?? context.data.location.default(),
})

/** Reads the effective auto-approve state from the server plugin, resolved across every loaded config entry. */
async function readAutoApprove(context: Plugin.Context): Promise<ServerAutoApproveState> {
  const result = await context.client.rpc(KiloAutoApproveRpc.Definition).get({}, located(context))
  return result.state
}

async function writeOnce(context: Plugin.Context, enabled: boolean) {
  const settings = context.client.rpc(KiloSettingsRpc.Definition)
  const location = located(context)
  const target = await settings.target({ scope: "global" }, location)
  // Always write an explicit boolean so disabling overrides any lower-precedence global document (for example
  // `kilo2.json` beneath `kilo2.jsonc`).
  await settings.write(
    {
      scope: "global",
      set: { auto_approve: enabled },
      ...(target.exists && target.revision ? { expected: { path: target.path, revision: target.revision } } : {}),
    },
    location,
  )
}

/** Writes the global rule, retrying once on a concurrent revision conflict. */
async function writeAutoApprove(context: Plugin.Context, enabled: boolean) {
  try {
    await writeOnce(context, enabled)
  } catch (error) {
    if (!isRecord(error) || error.type !== "conflict") throw error
    await writeOnce(context, enabled)
  }
}

export default Plugin.define({
  id: "kilocode.autoapprove",
  setup(context) {
    // Kept in setup scope: the `app` slot may re-render, and state must survive across slot re-renders.
    const [saving, setSaving] = createSignal(false)
    let server: ServerAutoApproveState = "disabled"
    // A server read started before a toggle must not overwrite the toggle's newer state.
    let generation = 0
    let startup: Promise<void> | undefined
    let readMode = (): PermissionMode => permissionModeOverride() ?? "prompt"
    let hasAutoFlag = () => false

    const applyServer = (next: ServerAutoApproveState) => {
      const previous = server
      server = next
      if (next === "enabled") {
        setPermissionMode("autoaccept")
        return
      }
      if (previous !== "enabled") return
      // The saved rule that was keeping this TUI on is gone. Keep `--auto` unless the user already left it.
      if (hasAutoFlag()) {
        if (permissionModeOverride() !== "prompt") setPermissionMode(undefined)
        return
      }
      setPermissionMode("prompt")
    }

    const readServer = async () => {
      if (saving()) return
      const current = ++generation
      const next = await readAutoApprove(context).catch(() => undefined)
      if (next === undefined || current !== generation) return
      applyServer(next)
    }

    const toast = (variant: "info" | "warning" | "error", key: keyof typeof dict) =>
      context.ui.toast.show({ variant, message: dict[key] })

    const toggle = async () => {
      await (startup ??= readServer())
      if (saving()) return
      const next = nextPermissionMode(readMode())
      // When `--auto` is the only reason auto-approve is active (or was just left), toggle only this process.
      if (hasAutoFlag() && server !== "enabled") {
        setPermissionMode(next)
        toast("info", next === "autoaccept" ? "tui.autoApprove.enabled" : "tui.autoApprove.disabled")
        return
      }
      if (next === "autoaccept" && server === "narrowed") {
        toast("warning", "tui.autoApprove.projectDisabled")
        return
      }
      if (next === "prompt" && server !== "enabled") {
        setPermissionMode("prompt")
        toast("info", "tui.autoApprove.disabled")
        return
      }
      setSaving(true)
      generation++
      await writeAutoApprove(context, next === "autoaccept")
        .then(() => {
          server = next === "autoaccept" ? "enabled" : "disabled"
          setPermissionMode(next)
          toast("info", next === "autoaccept" ? "tui.autoApprove.enabled" : "tui.autoApprove.disabled")
        })
        .catch(() => toast("error", "tui.autoApprove.saveFailed"))
        .finally(() => setSaving(false))
    }

    context.ui.slot({
      append: "app",
      render() {
        const permission = usePermission()
        const config = useConfig()
        const args = useArgs()
        readMode = () => permission.mode
        hasAutoFlag = () => args.auto === true
        startup ??= readServer()

        // A settings write means "use this mode", unless the saved global rule is what keeps auto-approve on.
        createEffect(
          on(
            () => config.data.session.permissions,
            () => {
              if (server !== "enabled") setPermissionMode(undefined)
            },
            { defer: true },
          ),
        )

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

    return createRoot((dispose) => {
      onCleanup(context.data.on("config.updated", () => void readServer()))
      onCleanup(() => {
        generation++
      })
      return dispose
    })
  },
})
