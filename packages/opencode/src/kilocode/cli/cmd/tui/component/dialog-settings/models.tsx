import { Show, onCleanup, type JSX } from "solid-js"
import { DialogSelect, type DialogSelectOption, type DialogSelectProps } from "@tui/ui/dialog-select"
import { useBindings } from "@tui/keymap"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"
import type { View } from "."
import type { Scope, SettingsState } from "./state"

export function ModelView(props: {
  ctx: SettingsState
  view: Extract<View, { name: "model" }>
  scope: Scope
  back: () => void
}) {
  const sync = useSync()
  const options = () => [
    {
      title: props.scope === "project" ? "Use inherited model" : "Use provider default",
      description:
        props.scope === "project"
          ? "Remove the project override and use the global setting."
          : "Remove the global override and use the provider default.",
      category: "Default",
      value: "",
    },
    ...sync.data.provider
      .flatMap((provider) =>
        Object.entries(provider.models).map(([id, model]) => ({
          title: model.name || id,
          description: `${provider.id}/${id}`,
          category: provider.name,
          value: `${provider.id}/${id}`,
        })),
      )
      .sort((a, b) => a.title.localeCompare(b.title)),
  ]

  return (
    <SettingsSelect
      title={`Choose ${props.view.title.toLowerCase()}`}
      options={options()}
      scrollbar={true}
      current={readString(props.ctx.field(props.view.field, props.scope))}
      busy={props.ctx.store.busy}
      back={props.back}
      onSelect={async (option) => {
        const ok = option.value
          ? await props.ctx.updateField(props.scope, props.view.field, option.value, props.view.title)
          : await props.ctx.unsetField(props.scope, props.view.field, props.view.title)
        if (ok) props.back()
      }}
    />
  )
}

export function SettingsSelect<T>(props: {
  title: string
  options: DialogSelectOption<T>[]
  current?: T
  locked?: boolean
  busy?: string
  scrollbar?: boolean
  back: () => void
  onMove?: DialogSelectProps<T>["onMove"]
  onSelect: (option: DialogSelectOption<T>) => void
  onCleanup?: () => void
  footer?: JSX.Element
}) {
  const { theme } = useTheme()
  useBindings(() => ({
    bindings: [{ key: "ctrl+b", desc: "Back to settings", group: "Settings", cmd: props.back }],
  }))
  onCleanup(() => props.onCleanup?.())

  return (
    <DialogSelect
      title={props.title}
      options={props.options}
      current={props.current}
      locked={props.locked || props.busy !== undefined}
      scrollbar={props.scrollbar}
      onMove={props.onMove}
      onSelect={props.onSelect}
      footer={
        <Show when={props.busy} fallback={props.footer}>
          {(label) => <Spinner color={theme.textMuted}>{label()}…</Spinner>}
        </Show>
      }
      footerHints={[{ title: "back", label: "ctrl+b" }]}
    />
  )
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
