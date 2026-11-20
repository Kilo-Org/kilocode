// `/auto-approve` (aliases `/autoapprove`, `/approve-all`, `/approveall`, `/yolo`) and Ctrl+Alt+A toggle the saved
// global auto-approve rule, the TUI counterpart of the VS Code shield and of v1's saved command. The rule lives in the
// global config, so every client stops prompting and the next TUI run restores it. The prompt metadata row shows
// "auto" while it is on.
import { dict } from "@kilocode/kilo-i18n/en"
import { Plugin } from "@opencode/plugin/tui"
import { KiloSettingsRpc } from "@opencode/schema/kilocode/settings"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { useConfig } from "../config"
import { useArgs } from "../context/args"
import { usePermission } from "../context/permission"
import { isRecord } from "../util/record"
import { nextPermissionMode, permissionModeOverride, setPermissionMode } from "./permission-mode"

export type ServerAutoApproveState = "enabled" | "narrowed" | "disabled"

/** The location the settings RPC answers for: the TUI's own project, the same one every other Kilo command reads. */
const located = (context: Plugin.Context) => ({
  location: context.location ?? context.data.location.default(),
})

/**
 * The saved auto-approve state: only the global config can enable it; a project `false` reports `"narrowed"` so the
 * toggle surfaces the project override instead of writing a global rule that cannot take effect here.
 */
export function savedAutoApproveState(global: unknown, project: unknown): ServerAutoApproveState {
  if (isRecord(project) && project.auto_approve === false) return "narrowed"
  if (isRecord(global) && global.auto_approve === true) return "enabled"
  return "disabled"
}

async function readAutoApprove(context: Plugin.Context) {
  const settings = context.client.rpc(KiloSettingsRpc.Definition)
  const location = located(context)
  const [global, project] = await Promise.all([
    settings.read({ scope: "global" }, location),
    settings.read({ scope: "project" }, location).catch(() => undefined),
  ])
  return savedAutoApproveState(global.document, project?.document)
}

async function writeOnce(context: Plugin.Context, enabled: boolean) {
  const settings = context.client.rpc(KiloSettingsRpc.Definition)
  const location = located(context)
  const current = await settings.read({ scope: "global" }, location)
  await settings.write(
    {
      scope: "global",
      set: { auto_approve: enabled ? true : null } as never,
      ...(current.target.revision
        ? { expected: { path: current.target.path, revision: current.target.revision } }
        : {}),
    },
    location,
  )
}

/** Writes the global rule, removing the key on disable and retrying once on a concurrent revision conflict. */
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
    context.ui.slot({
      append: "app",
      render() {
        const permission = usePermission()
        const config = useConfig()
        const args = useArgs()
        const [saving, setSaving] = createSignal(false)
        let server: ServerAutoApproveState = "disabled"
        // A server read started before a toggle must not overwrite the toggle's newer state.
        let generation = 0

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

        const applyServer = (next: ServerAutoApproveState) => {
          const previous = server
          server = next
          if (next === "enabled") {
            setPermissionMode("autoaccept")
            return
          }
          if (previous !== "enabled") return
          // The saved rule that was keeping this TUI on is gone. Keep `--auto` unless the user already left it.
          if (args.auto) {
            if (permissionModeOverride() !== "prompt") setPermissionMode(undefined)
            return
          }
          setPermissionMode("prompt")
        }

        const readServer = async () => {
          const current = ++generation
          const next = await readAutoApprove(context).catch(() => undefined)
          if (next === undefined || current !== generation) return
          applyServer(next)
        }

        const toast = (variant: "info" | "warning" | "error", key: keyof typeof dict) =>
          context.ui.toast.show({ variant, message: dict[key] })

        // The first read decides the current mode, so a toggle pressed before it settles waits for it.
        const startup = readServer()
        onCleanup(context.data.on("config.updated", () => void readServer()))

        const toggle = async () => {
          await startup
          if (saving()) return
          const next = nextPermissionMode(permission.mode)
          // When `--auto` is the only reason auto-approve is active (or was just left), toggle only this process.
          if (args.auto && server !== "enabled") {
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
          const current = ++generation
          await writeAutoApprove(context, next === "autoaccept")
            .then(() => {
              if (current !== generation) return
              server = next === "autoaccept" ? "enabled" : "disabled"
              setPermissionMode(next)
              toast("info", next === "autoaccept" ? "tui.autoApprove.enabled" : "tui.autoApprove.disabled")
            })
            .catch(() => toast("error", "tui.autoApprove.saveFailed"))
            .finally(() => setSaving(false))
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
