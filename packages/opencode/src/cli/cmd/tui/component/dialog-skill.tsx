import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createResource, createMemo, createSignal } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSkillMarketplace } from "@/kilocode/cli/cmd/tui/component/dialog-skill-marketplace" // kilocode_change

export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  // kilocode_change start - skill management (install/uninstall/browse marketplace)
  const [skills, { refetch }] = createResource(async () => {
    const result = await sdk.client.app.skills()
    return result.data ?? []
  })
  const [busy, setBusy] = createSignal<string | null>(null)
  // kilocode_change end
  dialog.setSize("large")

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list = skills() ?? []
    const maxWidth = Math.max(0, ...list.map((s) => s.name.length))
    return list.map((skill) => ({
      title: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.name,
      category: "Skills",
      onSelect: () => {
        props.onSelect(skill.name)
        dialog.clear()
      },
    }))
  })

  // kilocode_change start - management actions (browse/install/uninstall)
  const actions = createMemo(() => {
    const installed = new Set((skills() ?? []).map((s) => s.name))
    return [
      {
        command: "skill.marketplace.browse",
        title: "browse",
        requiresSelection: false as const,
        onTrigger: () => {
          dialog.replace(() => <DialogSkillMarketplace installed={installed} onInstalled={() => void refetch()} />)
        },
      },
      {
        command: "skill.install.url",
        title: "install url",
        requiresSelection: false as const,
        onTrigger: async () => {
          const url = await DialogPrompt.show(dialog, "Install skill from tarball URL", {
            placeholder: "https://example.com/skill.tar.gz",
          })
          if (!url) return
          const id = await DialogPrompt.show(dialog, "Skill id (directory name)", {
            placeholder: "my-skill",
          })
          if (!id) return
          setBusy(id)
          try {
            const result = await sdk.client.kilocode.installSkill({ id, url, scope: "global" })
            if (!result.data?.success) {
              console.error("Failed to install skill:", result.data?.error ?? "unknown error")
            }
            await refetch()
          } catch (err) {
            console.error("Failed to install skill:", err)
          } finally {
            setBusy(null)
          }
        },
      },
      {
        command: "skill.install.folder",
        title: "install folder",
        requiresSelection: false as const,
        onTrigger: async () => {
          const folder = await DialogPrompt.show(
            dialog,
            "Install skill from local folder (adds to kilo.json skills.paths)",
            {
              placeholder: "/path/to/skills/my-skill or ~/my-skills",
            },
          )
          if (!folder) return
          setBusy(folder)
          try {
            const result = await sdk.client.kilocode.installSkillFolder({ path: folder, scope: "global" })
            if (!result.data?.success) {
              console.error("Failed to add skill path to config:", result.data?.error ?? "unknown error")
            }
            await refetch()
          } catch (err) {
            console.error("Failed to add skill path to config:", err)
          } finally {
            setBusy(null)
          }
        },
      },
      {
        command: "skill.uninstall",
        title: "uninstall",
        requiresSelection: true as const,
        onTrigger: async (option: DialogSelectOption<string>) => {
          if (busy() !== null) return
          const id = option.value
          setBusy(id)
          try {
            const result = await sdk.client.kilocode.removeInstalledSkill({ id, scope: "global" })
            if (!result.data?.success) {
              console.error("Failed to uninstall skill:", result.data?.error ?? "unknown error")
            }
            await refetch()
          } catch (err) {
            console.error("Failed to uninstall skill:", err)
          } finally {
            setBusy(null)
          }
        },
      },
    ]
  })
  // kilocode_change end

  return <DialogSelect title="Skills" placeholder="Search skills..." options={options()} actions={actions()} /> // kilocode_change - actions
}
