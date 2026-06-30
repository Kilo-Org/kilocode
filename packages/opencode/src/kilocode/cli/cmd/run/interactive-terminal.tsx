/** @jsxImportSource @opentui/solid */
import { TextAttributes, decodePasteBytes, type MouseEvent, type PasteEvent } from "@opentui/core"
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/solid"
import type { RunInteractiveTerminalSnapshot } from "./types"
import { VtScreen } from "@/kilocode/cli/cmd/tui/vt/vt-screen"
import type { RunFooterTheme } from "@/cli/cmd/run/theme"
import { createEffect, createMemo, createSignal, on } from "solid-js"

export const RUN_INTERACTIVE_TERMINAL_ROWS = 18
const VIEW_ROWS = 14

type Props = {
  terminal: () => RunInteractiveTerminalSnapshot
  theme: RunFooterTheme
  onWrite: (input: { terminalID: string; data: string }) => Promise<void>
  onResize: (input: { terminalID: string; cols: number; rows: number }) => Promise<void>
  onClose: (terminalID: string) => Promise<void>
}

export function RunInteractiveTerminalBody(props: Props) {
  const term = useTerminalDimensions()
  const cols = createMemo(() => Math.max(20, term().width - 6))
  const state = {
    vt: new VtScreen(cols(), VIEW_ROWS),
    consumed: 0,
    input: Promise.resolve(),
  }
  const [version, refresh] = createSignal(0)
  const [offset, setOffset] = createSignal(0)
  const [closing, setClosing] = createSignal(false)

  function send(data: string) {
    if (!data || closing()) return
    state.input = state.input
      .then(() => props.onWrite({ terminalID: props.terminal().info.id, data }))
      .catch(() => undefined)
  }

  function scroll(delta: number) {
    setOffset((value) => Math.max(0, Math.min(state.vt.scrollbackSize(), value + delta)))
  }

  function close() {
    if (closing()) return
    setClosing(true)
    void props.onClose(props.terminal().info.id).catch(() => setClosing(false))
  }

  useKeyboard((event) => {
    if (event.eventType === "release") return
    event.preventDefault()
    event.stopPropagation()
    if (event.name === "pageup") {
      scroll(VIEW_ROWS - 1)
      return
    }
    if (event.name === "pagedown") {
      scroll(-(VIEW_ROWS - 1))
      return
    }
    if (event.name === "escape") {
      close()
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
    const terminal = props.terminal()
    const start = terminal.cursor - terminal.output.length
    if (state.consumed < start || state.consumed > terminal.cursor) {
      state.vt = new VtScreen(cols(), VIEW_ROWS)
      state.consumed = start
      setOffset(0)
    }
    const data = terminal.output.slice(state.consumed - start)
    state.consumed = terminal.cursor
    if (!data) return
    const before = state.vt.scrollCount()
    state.vt.write(data)
    const added = state.vt.scrollCount() - before
    setOffset((value) => Math.min(state.vt.scrollbackSize(), value > 0 ? value + added : 0))
    refresh((value) => value + 1)
  })

  createEffect(
    on(cols, (width) => {
      state.vt.resize(width, VIEW_ROWS)
      setOffset((value) => Math.min(state.vt.scrollbackSize(), value))
      refresh((value) => value + 1)
      void props.onResize({ terminalID: props.terminal().info.id, cols: width, rows: VIEW_ROWS }).catch(() => undefined)
    }),
  )

  const screen = createMemo(() => {
    version()
    return state.vt.viewText(offset(), VIEW_ROWS)
  })

  return (
    <box width="100%" height={RUN_INTERACTIVE_TERMINAL_ROWS} flexDirection="column" paddingLeft={2} paddingRight={2}>
      <box height={1} flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <text fg={props.theme.text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
          {props.terminal().info.description ?? props.terminal().info.command}
        </text>
        <box onMouseUp={close}>
          <text fg={closing() ? props.theme.muted : props.theme.error} wrapMode="none">
            {closing() ? "closing" : "x"}
          </text>
        </box>
      </box>
      <box
        height={VIEW_ROWS}
        overflow="hidden"
        flexShrink={0}
        onMouseScroll={(event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          const amount = Math.max(1, Math.abs(event.scroll?.delta ?? 1)) * 3
          if (event.scroll?.direction === "up") scroll(amount)
          if (event.scroll?.direction === "down") scroll(-amount)
        }}
      >
        <text fg={props.theme.text} wrapMode="none">
          {screen()}
        </text>
      </box>
      <box height={1} flexDirection="row" gap={2} flexShrink={0}>
        <text fg={props.theme.text} wrapMode="none">
          ctrl+c <span style={{ fg: props.theme.muted }}>interrupt</span>
        </text>
        <text fg={props.theme.text} wrapMode="none">
          pgup/pgdn <span style={{ fg: props.theme.muted }}>scroll{offset() > 0 ? ` (${offset()} up)` : ""}</span>
        </text>
      </box>
    </box>
  )
}
