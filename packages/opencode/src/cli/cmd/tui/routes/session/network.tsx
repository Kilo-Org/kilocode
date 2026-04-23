// kilocode_change - new file
/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../component/border"
import { useSDK } from "../../context/sdk"
import { useDialog } from "../../ui/dialog"
import type { SessionNetworkWait } from "@kilocode/sdk/v2"
import { useKeybind } from "../../context/keybind"

export function NetworkPrompt(props: { request: SessionNetworkWait }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dialog = useDialog()

  function reply() {
    void sdk.client.network.reply({ requestID: props.request.id }).catch(() => {})
  }

  function reject() {
    void sdk.client.network.reject({ requestID: props.request.id }).catch(() => {})
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (evt.name === "return" && props.request.restored) {
      evt.preventDefault()
      reply()
      return
    }
    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      reject()
    }
  })

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
          <text fg={theme.text}>Connection restored.</text>
          <text fg={theme.textMuted}>Press Enter to resume this turn.</text>
          <text fg={theme.textMuted}>Press Esc to stop.</text>
        </Show>
      </box>
    </box>
  )
}
