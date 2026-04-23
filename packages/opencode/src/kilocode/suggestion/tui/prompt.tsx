/** @jsxImportSource @opentui/solid */

import { useKeyboard } from "@opentui/solid"
import type { SuggestionRequest } from "@kilocode/sdk/v2"
import { createMemo, createSignal, For } from "solid-js"
import { SplitBorder } from "../../../cli/cmd/tui/component/border"
import { useKeybind } from "../../../cli/cmd/tui/context/keybind"
import { useSDK } from "../../../cli/cmd/tui/context/sdk"
import { tint, useTheme } from "../../../cli/cmd/tui/context/theme"
import { useDialog } from "../../../cli/cmd/tui/ui/dialog"

// The footer-mounted overlay only ever hosts blocking suggestions now; the
// built-in suggest tool emits non-blocking requests that render inline at
// the tool-part slot via `SuggestBar`. See `./bar.tsx` and the dispatch in
// `cli/cmd/tui/routes/session/index.tsx`.
export function SuggestPrompt(props: { request: SuggestionRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dialog = useDialog()

  const options = createMemo(() => props.request.actions)
  const [selected, setSelected] = createSignal(0)
  const [busy, setBusy] = createSignal(false)

  function accept(index: number) {
    if (busy()) return
    setBusy(true)
    sdk.client.suggestion
      .accept({
        requestID: props.request.id,
        index,
      })
      .catch(() => {
        setBusy(false)
      })
  }

  function reject() {
    if (busy()) return
    setBusy(true)
    sdk.client.suggestion
      .dismiss({
        requestID: props.request.id,
      })
      .catch(() => {
        setBusy(false)
      })
  }

  function choose(index: number) {
    accept(index)
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return

    if (evt.name === "escape") {
      evt.preventDefault()
      reject()
      return
    }

    const total = options().length
    const max = Math.min(total, 9)
    const digit = Number(evt.name)

    if (!Number.isNaN(digit) && digit >= 1 && digit <= max) {
      evt.preventDefault()
      const index = digit - 1
      setSelected(index)
      choose(index)
      return
    }

    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      setSelected((selected() - 1 + total) % total)
      return
    }

    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      setSelected((selected() + 1) % total)
      return
    }

    if (evt.name === "return") {
      evt.preventDefault()
      choose(selected())
      return
    }

    if (keybind.match("app_exit", evt)) {
      evt.preventDefault()
      reject()
    }
  })

  const note = createMemo(() => (busy() ? "Waiting..." : undefined))

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.secondary}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={1}>
          <text fg={theme.text}>{props.request.text}</text>
        </box>

        <box>
          <For each={options()}>
            {(opt, i) => {
              const active = () => i() === selected()
              return (
                <box
                  onMouseOver={() => setSelected(i())}
                  onMouseDown={() => setSelected(i())}
                  onMouseUp={() => choose(i())}
                >
                  <box flexDirection="row">
                    <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                      <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                        {`${i() + 1}.`}
                      </text>
                    </box>
                    <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                      <text fg={active() ? theme.secondary : theme.text}>{opt.label}</text>
                    </box>
                  </box>

                  <box paddingLeft={3}>
                    <text fg={theme.textMuted}>{opt.description}</text>
                  </box>
                </box>
              )
            }}
          </For>
        </box>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={2}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            {"↑↓"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>choose</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>dismiss</span>
          </text>
        </box>
        <text fg={theme.textMuted}>{note()}</text>
      </box>
    </box>
  )
}
