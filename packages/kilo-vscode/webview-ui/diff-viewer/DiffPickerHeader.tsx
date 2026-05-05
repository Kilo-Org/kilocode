import type { Component } from "solid-js"
import { Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { useLanguage } from "../src/context/language"
import type { DiffSourceDescriptor } from "../src/types/messages/extension-messages"

interface DiffPickerHeaderProps {
  descriptors: DiffSourceDescriptor[]
  currentId: string | undefined
  onSelect: (id: string) => void
}

const GROUP_KEYS: Record<DiffSourceDescriptor["group"], string> = {
  Workspace: "diffViewer.group.workspace",
  Session: "diffViewer.group.session",
  Git: "diffViewer.group.git",
}

export const DiffPickerHeader: Component<DiffPickerHeaderProps> = (props) => {
  const { t } = useLanguage()
  const current = () => props.descriptors.find((d) => d.id === props.currentId)

  // Translate well-known source ids; fall back to the descriptor's plain label.
  const label = (d: DiffSourceDescriptor): string => {
    if (d.id === "workspace") return t("diffViewer.source.workspace.label")
    if (d.id.startsWith("session:")) return t("diffViewer.source.session.label")
    return d.label
  }

  const group = (d: DiffSourceDescriptor): string => t(GROUP_KEYS[d.group])

  return (
    <div data-component="diff-picker-header">
      <Show
        when={props.descriptors.length > 1}
        fallback={
          <span data-slot="diff-picker-single-label">
            <Show when={current()} fallback="">
              {(d) => label(d())}
            </Show>
          </span>
        }
      >
        <Select<DiffSourceDescriptor>
          options={props.descriptors}
          current={current()}
          value={(d) => d.id}
          label={label}
          groupBy={group}
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
