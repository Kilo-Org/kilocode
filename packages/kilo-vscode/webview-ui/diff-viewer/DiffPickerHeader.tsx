import type { Component } from "solid-js"
import { Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import type { DiffSourceDescriptor } from "../src/types/messages/extension-messages"

interface DiffPickerHeaderProps {
  descriptors: DiffSourceDescriptor[]
  currentId: string | undefined
  onSelect: (id: string) => void
}

export const DiffPickerHeader: Component<DiffPickerHeaderProps> = (props) => {
  const current = () => props.descriptors.find((d) => d.id === props.currentId)

  return (
    <div data-component="diff-picker-header">
      <Show
        when={props.descriptors.length > 1}
        fallback={<span data-slot="diff-picker-single-label">{current()?.label ?? ""}</span>}
      >
        <Select<DiffSourceDescriptor>
          options={props.descriptors}
          current={current()}
          value={(d) => d.id}
          label={(d) => d.label}
          groupBy={(d) => d.group}
          variant="secondary"
          size="small"
          onSelect={(d) => {
            if (d) props.onSelect(d.id)
          }}
        />
      </Show>
    </div>
  )
}
