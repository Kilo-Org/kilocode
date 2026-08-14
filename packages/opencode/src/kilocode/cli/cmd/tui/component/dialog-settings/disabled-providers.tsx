import { DialogSelect } from "@tui/ui/dialog-select"
import { useBindings } from "@tui/keymap"
import { Show } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"
import type { SettingsState } from "./state"

export function DisabledProvidersView(props: { ctx: SettingsState; back: () => void }) {
  const { theme } = useTheme()
  const sync = useSync()
  const options = () =>
    sync.data.provider_next.disabled
      .map((provider) => ({
        title: provider.name,
        description: provider.id,
        category: "Disabled providers",
        value: provider.id,
        footer: "disabled",
      }))
      .sort((a, b) => a.title.localeCompare(b.title))

  useBindings(() => ({
    bindings: [{ key: "ctrl+b", desc: "Back to settings", group: "Settings", cmd: props.back }],
  }))

  return (
    <DialogSelect
      title="Disabled providers"
      options={options()}
      renderFilter={false}
      locked={props.ctx.store.busy !== undefined}
      onSelect={async (option) => {
        const ok = await props.ctx.enableProvider(option.value, option.title)
        if (ok) props.back()
      }}
      footer={
        <Show when={props.ctx.store.busy}>
          {(label) => <Spinner color={theme.textMuted}>{label()}…</Spinner>}
        </Show>
      }
      footerHints={[{ title: "back", label: "ctrl+b" }, { title: "enable", label: "enter" }]}
    />
  )
}
