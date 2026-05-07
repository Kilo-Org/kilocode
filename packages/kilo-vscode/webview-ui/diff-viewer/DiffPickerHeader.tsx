import type { Component } from "solid-js"
import { createSignal, Show } from "solid-js"
import { Select } from "@kilocode/kilo-ui/select"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"
import type { DiffSourceDescriptor } from "../../src/diff/sources/types"

interface DiffPickerHeaderProps {
  descriptors: DiffSourceDescriptor[]
  currentId: string | undefined
  onSelect: (id: string) => void
}

const GROUP_KEYS: Record<DiffSourceDescriptor["group"], string> = {
  Session: "diffViewer.group.session",
  Git: "diffViewer.group.git",
}

const TOOLTIP_OPEN_DELAY_MS = 500

export const DiffPickerHeader: Component<DiffPickerHeaderProps> = (props) => {
  const { t } = useLanguage()
  const current = () => props.descriptors.find((d) => d.id === props.currentId)
  const [highlight, setHighlight] = createSignal<string | undefined>(undefined)

  const label = (desc: DiffSourceDescriptor): string => t(`diffViewer.source.${desc.type}.label`)

  const tooltip = (desc: DiffSourceDescriptor): string => t(`diffViewer.source.${desc.type}.tooltip`)

  const group = (desc: DiffSourceDescriptor): string => t(GROUP_KEYS[desc.group])

  const onHighlight = (desc: DiffSourceDescriptor | undefined) => {
    if (!desc) {
      setHighlight(undefined)
      return
    }
    const timer = setTimeout(() => setHighlight(desc.id), TOOLTIP_OPEN_DELAY_MS)
    return () => {
      clearTimeout(timer)
      setHighlight(undefined)
    }
  }

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
          onHighlight={onHighlight}
        >
          {(desc) => {
            if (!desc) return ""
            return (
              <Tooltip value={tooltip(desc)} placement="right" forceOpen={highlight() === desc.id}>
                <span data-slot="diff-picker-option-label">{label(desc)}</span>
              </Tooltip>
            )
          }}
        </Select>
      </Show>
    </div>
  )
}
