// kilocode_change - new file
import { TextAttributes, decodePasteBytes, type MouseEvent, type PasteEvent } from "@opentui/core"
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { InteractiveTerminalSnapshot } from "@kilocode/sdk/v2"
import { VtScreen } from "@/kilocode/cli/cmd/tui/vt/vt-screen"
import { SplitBorder } from "@tui/component/border"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { createEffect, createMemo, createSignal, on, onMount } from "solid-js"

export function TerminalPrompt(props: { sessionID: string; terminalID: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const [snapshot, setSnapshot] = createSignal<InteractiveTerminalSnapshot>()
  function terminal() {
    const live = sync.data.interactive_terminal[props.sessionID]?.find((item) => item.info.id === props.terminalID)
    const polled = snapshot()
    if (!live) return polled
    if (!polled || live.cursor >= polled.cursor) return live
    return polled
  }
  const cols = createMemo(() => Math.max(20, dimensions().width - 8))
  const rows = createMemo(() => Math.max(6, Math.min(18, dimensions().height - 12)))
  const state = {
    vt: new VtScreen(cols(), rows()),
    consumed: 0,
    input: Promise.resolve(),
    polling: false,
  }
  const [version, refresh] = createSignal(0)
  const [offset, setOffset] = createSignal(0)
  const [closing, setClosing] = createSignal(false)

  function send(data: string) {
    if (!data || closing()) return
    state.input = state.input
      .then(() =>
        sdk.client.interactiveTerminal.write({
          terminalID: props.terminalID,
          interactiveTerminalWriteInput: { data },
        }),
      )
      .then(() => undefined)
      .catch(() => undefined)
  }

  function close() {
    if (closing()) return
    setClosing(true)
    void sdk.client.interactiveTerminal.close({ terminalID: props.terminalID }).catch(() => {
      setClosing(false)
    })
  }

  function scroll(delta: number) {
    setOffset((value) => Math.max(0, Math.min(state.vt.scrollbackSize(), value + delta)))
  }

  function poll() {
    if (state.polling || closing()) return
    state.polling = true
    void sdk.client.interactiveTerminal
      .get({ terminalID: props.terminalID })
      .then((result) => {
        if (result.data) setSnapshot(result.data)
      })
      .catch(() => undefined)
      .finally(() => {
        state.polling = false
      })
  }

  onMount(() => {
    poll()
  })

  useKeyboard((event) => {
    if (event.eventType === "release") return
    event.preventDefault()
    event.stopPropagation()
    if (event.name === "pageup") {
      scroll(Math.max(1, rows() - 1))
      return
    }
    if (event.name === "pagedown") {
      scroll(-Math.max(1, rows() - 1))
      return
    }
    send(event.raw || event.sequence)
  })

  usePaste((event: PasteEvent) => {
    event.preventDefault()
    event.stopPropagation()
    send(decodePasteBytes(event.bytes))
  })

  createEffect(() => {
    const current = terminal()
    if (!current) return
    const output = current.output
    const cursor = current.cursor
    const start = cursor - output.length
    if (state.consumed < start || state.consumed > cursor) {
      state.vt = new VtScreen(cols(), rows())
      state.consumed = start
      setOffset(0)
    }
    const data = output.slice(state.consumed - start)
    state.consumed = cursor
    if (!data) return
    const before = state.vt.scrollCount()
    state.vt.write(data)
    const added = state.vt.scrollCount() - before
    setOffset((value) => {
      const next = value > 0 ? value + added : 0
      return Math.min(state.vt.scrollbackSize(), next)
    })
    refresh((value) => value + 1)
  })

  createEffect(
    on([cols, rows], ([width, height]) => {
      state.vt.resize(width, height)
      setOffset((value) => Math.min(state.vt.scrollbackSize(), value))
      refresh((value) => value + 1)
      void sdk.client.interactiveTerminal
        .resize({
          terminalID: props.terminalID,
          interactiveTerminalResizeInput: { cols: width, rows: height },
        })
        .catch(() => undefined)
    }),
  )

  const screen = createMemo(() => {
    version()
    return state.vt.viewText(offset(), rows())
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
      flexShrink={0}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {terminal()?.info.description ?? terminal()?.info.command ?? props.terminalID}
        </text>
        <box
          onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            close()
          }}
        >
          <text fg={closing() ? theme.textMuted : theme.error}>{closing() ? "closing" : "x"}</text>
        </box>
      </box>
      <box
        paddingLeft={2}
        paddingRight={2}
        height={rows()}
        overflow="hidden"
        onMouseScroll={(event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          const amount = Math.max(1, Math.abs(event.scroll?.delta ?? 1)) * 3
          if (event.scroll?.direction === "up") scroll(amount)
          if (event.scroll?.direction === "down") scroll(-amount)
        }}
      >
        <text fg={theme.text} wrapMode="none">
          {screen()}
        </text>
      </box>
      <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={2} paddingBottom={1} paddingTop={1}>
        <text fg={theme.text}>
          ctrl+c <span style={{ fg: theme.textMuted }}>interrupt</span>
        </text>
        <text fg={theme.text}>
          pgup/pgdn <span style={{ fg: theme.textMuted }}>scroll{offset() > 0 ? ` (${offset()} lines up)` : ""}</span>
        </text>
        <text fg={theme.text}>
          click x <span style={{ fg: theme.textMuted }}>force close</span>
        </text>
      </box>
    </box>
  )
}
