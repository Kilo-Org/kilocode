import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.displayName ?? item.name, // kilocode_change
        description:
          [item.deprecated && "deprecated", item.native && "native"].filter(Boolean).join(", ") || item.description,
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current()?.name ?? ""} // kilocode_change
      options={options()}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
