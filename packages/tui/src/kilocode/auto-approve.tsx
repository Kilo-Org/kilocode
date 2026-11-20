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
import { nextPermissionMode, setPermissionMode } from "./permission-mode"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The location the settings RPC answers for: the TUI's own project, the same one every other Kilo command reads. */
const located = (context: Plugin.Context) => ({
  location: context.location ?? context.data.location.default(),
})

/** The saved auto-approve state: only global can enable it, a project `false` can narrow it. */
export function savedAutoApprove(global: unknown, project: unknown) {
  const projectValue = isRecord(project) ? project.auto_approve : undefined
  if (projectValue === false) return false
  return isRecord(global) && global.auto_approve === true
}

async function readAutoApprove(context: Plugin.Context) {
  const settings = context.client.rpc(KiloSettingsRpc.Definition)
  const location = located(context)
  const [global, project] = await Promise.all([
    settings.read({ scope: "global" }, location),
    settings.read({ scope: "project" }, location).catch(() => undefined),
  ])
  return savedAutoApprove(global.document, project?.document)
}

/** Writes the global rule, removing the key on disable so the config never keeps a stale `false`. */
async function writeAutoApprove(context: Plugin.Context, enabled: boolean) {
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
        let server: boolean | undefined

        // A settings write means "use this mode", unless the saved global rule is what keeps auto-approve on.
        createEffect(
          on(
            () => config.data.session.permissions,
            () => {
              if (server !== true) setPermissionMode(undefined)
            },
            { defer: true },
          ),
        )

        const applyServer = (enabled: boolean) => {
          if (enabled) {
            server = true
            setPermissionMode("autoaccept")
            return
          }
          if (server !== true) {
            server = false
            return
          }
          server = false
          // The rule that was keeping this TUI on is gone. Leave only `--auto` in control.
          setPermissionMode(args.auto ? "autoaccept" : "prompt")
        }
        const readServer = () => readAutoApprove(context).then(applyServer).catch(() => undefined)

        // The first read decides the current mode, so a toggle pressed before it settles waits for it.
        const startup = readServer()
        onCleanup(context.data.on("config.updated", readServer))

        const toggle = async () => {
          await startup
          if (saving()) return
          setSaving(true)
          // With `--auto`, the command also leaves the launch flag; otherwise it toggles the saved rule itself.
          const next = args.auto
            ? nextPermissionMode(permission.mode)
            : server === true
              ? "prompt"
              : "autoaccept"
          await writeAutoApprove(context, next === "autoaccept")
            .then(() => {
              setPermissionMode(next)
              readServer()
              context.ui.toast.show({
                variant: "info",
                message: dict[next === "autoaccept" ? "tui.autoApprove.enabled" : "tui.autoApprove.disabled"],
              })
            })
            .catch(() =>
              context.ui.toast.show({
                variant: "error",
                message: dict["tui.autoApprove.saveFailed"],
              }),
            )
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
