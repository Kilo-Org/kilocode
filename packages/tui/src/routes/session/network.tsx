// kilocode_change - new file
/** @jsxImportSource @opentui/solid */
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import { useSDK } from "../../context/sdk"
import { useDialog } from "../../ui/dialog"
import type { SessionNetworkWait } from "@kilocode/sdk/v2"
import { useTuiConfig } from "../../config"
import { useBindings } from "../../keymap"

export function NetworkPrompt(props: { request: SessionNetworkWait }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const config = useTuiConfig()
  const dialog = useDialog()
  const [countdown, setCountdown] = createSignal(10)

  function reply() {
    void sdk.client.network.reply({ requestID: props.request.id }).catch(() => {})
  }

  function reject() {
    void sdk.client.network.reject({ requestID: props.request.id }).catch(() => {})
  }

  createEffect(() => {
    if (!props.request.restored) {
      setCountdown(10)
      return
    }
    const started = Date.now()
    const remaining = () => Math.max(0, 10 - Math.floor((Date.now() - started) / 1000))
    setCountdown(remaining())
    const timer = setInterval(() => {
      const next = remaining()
      setCountdown(next)
      if (next <= 0) clearInterval(timer)
    }, 250)
    onCleanup(() => clearInterval(timer))
  })

  useBindings(() => ({
    enabled: dialog.stack.length === 0,
    bindings: [
      ...(props.request.restored ? [{ key: "return", desc: "Resume now", group: "Network", cmd: reply }] : []),
      { key: "escape", desc: "Stop turn", group: "Network", cmd: reject },
      ...config.keybinds.get("app.exit").map((binding) => ({ ...binding, cmd: reject })),
    ],
  }))

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box flexDirection="column" gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <Show
          when={props.request.restored}
          fallback={
            <>
              <text fg={theme.warning}>Network disconnected</text>
              <text fg={theme.text}>{props.request.message}</text>
              <text fg={theme.textMuted}>Waiting for network...</text>
              <text fg={theme.textMuted}>Press Esc to stop this turn.</text>
            </>
          }
        >
          <text fg={theme.success}>Network reconnected</text>
          <text fg={theme.text}>Connection restored. Retrying in {countdown()}s.</text>
          <text fg={theme.textMuted}>Press Enter to resume now.</text>
          <text fg={theme.textMuted}>Press Esc to stop.</text>
        </Show>
      </box>
    </box>
  )
}
