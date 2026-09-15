import { DialogSelect } from "@tui/ui/dialog-select"
import { useBindings } from "@tui/keymap"
import { Show, createSignal } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"
import type { Scope, SettingsState } from "./state"

export function DisabledProvidersView(props: { ctx: SettingsState; scope: Scope; back: () => void }) {
  const { theme } = useTheme()
  const [confirming, setConfirming] = createSignal<{ id: string; title: string } | null>(null)
  const options = () => {
    const target = confirming()
    if (target) {
      return [
        {
          title: `Enable ${target.title} in both scopes`,
          description: `${target.title} is hidden in both project and global config. Enabling will clear it from both.`,
          category: "Confirmation",
          value: "confirm",
        },
      ]
    }
    return props.ctx.store.disabledProviders
      .map((provider) => ({
        title: provider.name,
        description: provider.id,
        category: "Disabled providers",
        value: provider.id,
        footer: "disabled",
      }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  useBindings(() => ({
    bindings: [
      {
        key: "ctrl+b",
        desc: confirming() ? "Cancel" : "Back to settings",
        group: "Settings",
        cmd: () => {
          if (confirming()) {
            setConfirming(null)
            return
          }
          props.back()
        },
      },
    ],
  }))

  return (
    <DialogSelect
      title={confirming() ? "Enable across both scopes?" : "Disabled providers"}
      options={options()}
      renderFilter={false}
      locked={props.ctx.store.busy !== undefined}
      truncateOverflow
      compactFooter
      onSelect={async (option) => {
        if (confirming()) {
          const target = confirming()!
          setConfirming(null)
          const ok = await props.ctx.enableProvider(target.id, target.title, props.scope)
          if (ok) props.back()
          return
        }
        if (props.ctx.isHiddenInOtherScope(option.value, props.scope)) {
          setConfirming({ id: option.value, title: option.title })
          return
        }
        const ok = await props.ctx.enableProvider(option.value, option.title, props.scope)
        if (ok) props.back()
      }}
      footer={
        <Show when={props.ctx.store.busy}>
          {(label) => <Spinner color={theme.textMuted}>{label()}…</Spinner>}
        </Show>
      }
      footerHints={[{ title: confirming() ? "cancel" : "back", label: "ctrl+b" }]}
    />
  )
}