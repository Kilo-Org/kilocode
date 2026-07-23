import { DialogSelect } from "@tui/ui/dialog-select"
import { useBindings } from "@tui/keymap"
import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"
import type { SettingsState } from "./state"

export function PluginsView(props: { ctx: SettingsState; back: () => void }) {
  const { theme } = useTheme()
  const plugins = () => {
    const list = (props.ctx.tui("plugin") as unknown[] | undefined) ?? []
    return list
      .map((item) => {
        if (typeof item === "string") return { id: item, name: item }
        if (Array.isArray(item) && typeof item[0] === "string") return { id: item[0], name: item[0] }
        return null
      })
      .filter((item): item is { id: string; name: string } => item !== null)
  }
  const enabledMap = () => (props.ctx.tui("plugin_enabled") as Record<string, boolean> | undefined) ?? {}
  const options = () => {
    return plugins()
      .map((plugin) => ({
        title: plugin.name,
        description:
          plugin.id in enabledMap() ? (enabledMap()[plugin.id] ? "Enabled" : "Disabled") : "Enabled (default)",
        category: "Plugins",
        value: plugin.id,
        footer: plugin.id in enabledMap() ? (enabledMap()[plugin.id] ? "on" : "off") : "on",
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  useBindings(() => ({
    bindings: [{ key: "ctrl+b", desc: "Back to settings", group: "Settings", cmd: props.back }],
  }))

  return (
    <DialogSelect
      title="Plugins"
      options={options()}
      locked={props.ctx.store.busy !== undefined}
      onSelect={async (option) => {
        const map = enabledMap()
        const current = option.value in map ? !!map[option.value] : true
        await props.ctx.togglePlugin(option.value, !current, option.value)
      }}
      footer={
        <Show when={props.ctx.store.busy}>
          {(label) => <Spinner color={theme.textMuted}>{label()}…</Spinner>}
        </Show>
      }
      footerHints={[{ title: "back", label: "ctrl+b" }]}
    />
  )
}
