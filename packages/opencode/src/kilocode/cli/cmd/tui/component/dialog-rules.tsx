// kilocode_change - new file
import { createMemo, createResource } from "solid-js"
import { useProject } from "@tui/context/project"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"

export function DialogRules() {
  const project = useProject()
  const sdk = useSDK()
  const dialog = useDialog()
  dialog.setSize("large")

  const [rules] = createResource(async () => {
    const result = await sdk.client.kilocode.rules({ workspace: project.workspace.current() }, { throwOnError: true })
    return result.data ?? []
  })

  const options = createMemo<DialogSelectOption<string>[]>(() =>
    (rules() ?? []).map((rule) => ({
      title: rule.name,
      description: rule.path,
      value: rule.path,
      category: "Rules",
    })),
  )

  return <DialogSelect title="Rules" placeholder="Search rules..." options={options()} />
}
