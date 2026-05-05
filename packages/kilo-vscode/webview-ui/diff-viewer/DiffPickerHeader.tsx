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

  const label = (d: DiffSourceDescriptor): string => {
    if (d.id === "workspace") return t("diffViewer.source.workspace.label")
    if (d.id.startsWith("session:")) return t("diffViewer.source.session.label")
    return d.label
  }

  const tooltip = (d: DiffSourceDescriptor): string | undefined => {
    if (d.id === "workspace") return t("diffViewer.source.workspace.tooltip")
    return undefined
  }

  const group = (d: DiffSourceDescriptor): string => t(GROUP_KEYS[d.group])

  const onHighlight = (d: DiffSourceDescriptor | undefined) => {
    if (!d || !tooltip(d)) {
      setHighlight(undefined)
      return
    }
    const timer = setTimeout(() => setHighlight(d.id), TOOLTIP_OPEN_DELAY_MS)
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
          {(d) => {
            if (!d) return ""
            const text = tooltip(d)
            if (!text) return label(d)
            return (
              <Tooltip value={text} placement="right" forceOpen={highlight() === d.id}>
                <span data-slot="diff-picker-option-label">{label(d)}</span>
              </Tooltip>
            )
          }}
        </Select>
      </Show>
    </div>
  )
}
