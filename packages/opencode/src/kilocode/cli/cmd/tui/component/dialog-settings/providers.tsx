import { DialogSelect } from "@tui/ui/dialog-select"
import { useBindings } from "@tui/keymap"
import { Show, createSignal } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"
import type { View } from "."
import type { SettingsState } from "./state"

export function ProviderView(props: {
  ctx: SettingsState
  view: Extract<View, { name: "provider" }>
  back: () => void
}) {
  const { theme } = useTheme()
  const managed = props.view.source === "env" || props.view.source === "config"
  const [confirm, setConfirm] = createSignal<"disconnect" | "disable" | null>(null)
  const options = () => {
    if (confirm() === "disconnect") {
      return [
        {
          title: "Keep connected",
          description: "Return without changing this provider.",
          category: "Confirmation",
          value: "cancel",
        },
        {
          title: `Disconnect ${props.view.title}`,
          description: "Permanently remove the credentials stored by Kilo.",
          category: "Confirmation",
          value: "confirm",
        },
      ]
    }
    if (confirm() === "disable") {
      return [
        {
          title: "Keep enabled",
          description: "Return without hiding this provider.",
          category: "Confirmation",
          value: "cancel",
        },
        {
          title: `Disable ${props.view.title}`,
          description: "Hide this provider from pickers and the model catalog.",
          category: "Confirmation",
          value: "confirm",
        },
      ]
    }
    return [
      managed
        ? {
            title: `Disconnect ${props.view.title}`,
            description:
              props.view.source === "env"
                ? "This provider is managed by an environment variable. Remove that variable to disconnect it."
                : "This provider is managed in your config file. Remove its credentials there to disconnect it.",
            category: "Provider",
            value: "info",
          }
        : {
            title: "Disconnect credentials",
            description: "Remove the credentials stored by Kilo for this provider.",
            category: "Provider",
            value: "disconnect",
          },
      {
        title: `Disable ${props.view.title}`,
        description:
          "Hide this provider from pickers and the model catalog without removing credentials.",
        category: "Provider",
        value: "disable",
      },
      {
        title: "Back to settings",
        value: "back",
      },
    ]
  }

  useBindings(() => ({
    bindings: [
      {
        key: "ctrl+b",
        desc: confirm() ? "Cancel" : "Back to settings",
        group: "Settings",
        cmd: () => {
          if (confirm()) {
            setConfirm(null)
            return
          }
          props.back()
        },
      },
    ],
  }))

  return (
    <DialogSelect
      title={
        confirm() === "disable"
          ? `Disable ${props.view.title}?`
          : confirm() === "disconnect"
            ? `Disconnect ${props.view.title}?`
            : props.view.title
      }
      renderFilter={false}
      locked={props.ctx.store.busy !== undefined}
      options={options()}
      onSelect={async (option) => {
        if (confirm()) {
          if (option.value === "cancel") {
            setConfirm(null)
            return
          }
          const ok =
            confirm() === "disable"
              ? await props.ctx.disableProvider(props.view.id, props.view.title)
              : await props.ctx.disconnect(props.view.id, props.view.title)
          if (ok) props.back()
          return
        }
        if (option.value === "back") {
          props.back()
          return
        }
        if (option.value === "disconnect") {
          setConfirm("disconnect")
          return
        }
        if (option.value === "disable") {
          setConfirm("disable")
        }
      }}
      footer={
        <Show when={props.ctx.store.busy}>{(label) => <Spinner color={theme.textMuted}>{label()}…</Spinner>}</Show>
      }
      footerHints={[{ title: confirm() ? "cancel" : "back", label: "ctrl+b" }]}
    />
  )
}
