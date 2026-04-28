/** @jsxImportSource @opentui/solid */
// kilocode_change - new file

import type { SuggestionRequest } from "@kilocode/sdk/v2"
import { createMemo, createSignal, For } from "solid-js"
import { useSDK } from "../../../cli/cmd/tui/context/sdk"
import { selectedForeground, useTheme } from "../../../cli/cmd/tui/context/theme"

export function SuggestBar(props: { request: SuggestionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()

  const options = createMemo(() => props.request.actions)
  const [busy, setBusy] = createSignal(false)

  function accept(index: number) {
    if (busy()) return
    setBusy(true)
    sdk.client.suggestion
      .accept({
        requestID: props.request.id,
        index,
      })
      .catch(() => setBusy(false))
  }

  return (
    <box
      marginTop={1}
      backgroundColor={theme.backgroundElement}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      flexShrink={0}
    >
      <box flexDirection="row" gap={1} flexShrink={1}>
        <text fg={theme.secondary}>→</text>
        <text fg={theme.text}>{props.request.text}</text>
      </box>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <For each={options()}>
          {(opt, i) => {
            const [hover, setHover] = createSignal(false)
            const primary = () => i() === 0
            const bg = () => {
              if (busy()) return undefined
              if (hover()) return theme.accent
              if (primary()) return theme.backgroundPanel
              return undefined
            }
            const fg = () => {
              if (busy()) return theme.textMuted
              if (hover()) return selectedForeground(theme, theme.accent)
              return theme.text
            }
            return (
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={bg()}
                onMouseOver={() => setHover(true)}
                onMouseOut={() => setHover(false)}
                onMouseUp={() => accept(i())}
              >
                <text fg={fg()}>{opt.label}</text>
              </box>
            )
          }}
        </For>
      </box>
    </box>
  )
}
