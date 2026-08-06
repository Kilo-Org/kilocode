/**
 * KiloClaw chat slash-command autocomplete.
 *
 * Slim port of `cli/cmd/tui/component/prompt/autocomplete.tsx` — drops the
 * `@`-mode branches (file mentions, agents, MCP resources, frecency,
 * extmark wiring) and only handles `/` slash commands.
 *
 * Source of slash commands is supplied by the caller via the `slashes`
 * prop. We intentionally do NOT pull from the global `useCommandSlashes()` registry
 * because that registry holds globally-registered commands across all
 * routes (e.g. the home route's `/new` for sessions), which would clash
 * with kiloclaw's own `/new` for conversations.
 *
 * Mounts as an absolutely-positioned popup above the chat textarea and
 * suspends the global command keybinds while open so arrow keys drive the
 * popup instead of triggering palette commands.
 */

import type { BoxRenderable, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import fuzzysort from "fuzzysort"
import { Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useTerminalDimensions } from "@opentui/solid"
import { SplitBorder } from "@tui/ui/border"
import { useBindings, useOpencodeModeStack } from "@tui/keymap"
import { selectedForeground, useTheme } from "@tui/context/theme"

export type ClawAutocompleteRef = {
  onInput: (value: string) => void
  onCursorChange: () => void
  dismiss: () => void
  visible: boolean
}

export type ClawSlashOption = {
  display: string
  description?: string
  aliases?: string[]
  onSelect: () => void
}

export function ClawAutocomplete(props: {
  value: string
  slashes: () => ClawSlashOption[]
  anchor: () => BoxRenderable | undefined
  input: () => TextareaRenderable | undefined
  ref: (ref: ClawAutocompleteRef) => void
}) {
  const modeStack = useOpencodeModeStack()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const [store, setStore] = createStore({
    index: 0,
    selected: 0,
    visible: false as boolean,
  })

  const [positionTick, setPositionTick] = createSignal(0)

  createEffect(() => {
    if (!store.visible) return
    const pop = modeStack.push("autocomplete")
    onCleanup(pop)
  })

  // Reposition the popup if the anchor moves (e.g., textarea grows).
  createEffect(() => {
    if (!store.visible) return
    let last = { x: 0, y: 0, width: 0 }
    const interval = setInterval(() => {
      const a = props.anchor()
      if (!a) return
      if (a.x !== last.x || a.y !== last.y || a.width !== last.width) {
        last = { x: a.x, y: a.y, width: a.width }
        setPositionTick((t) => t + 1)
      }
    }, 50)
    onCleanup(() => clearInterval(interval))
  })

  const position = createMemo(() => {
    if (!store.visible) return { x: 0, y: 0, width: 0 }
    dimensions()
    positionTick()
    const anchor = props.anchor()
    if (!anchor) return { x: 0, y: 0, width: 0 }
    const parent = anchor.parent
    const parentX = parent?.x ?? 0
    const parentY = parent?.y ?? 0
    return {
      x: anchor.x - parentX,
      y: anchor.y - parentY,
      width: anchor.width,
    }
  })

  // Filter text — everything after the trigger up to the cursor.
  const filter = createMemo(() => {
    if (!store.visible) return ""
    const inp = props.input()
    if (!inp) return ""
    props.value // reactive dep
    return inp.getTextRange(store.index + 1, inp.cursorOffset)
  })

  const [search, setSearch] = createSignal("")
  createEffect(() => {
    setSearch(filter())
  })

  const options = createMemo<ClawSlashOption[]>(() => {
    const all = props.slashes()
    const q = search()
    if (!q) return all
    const result = fuzzysort.go(q, all, {
      keys: [(o) => o.display.trimEnd(), "description", (o) => o.aliases?.join(" ") ?? ""],
      limit: 10,
      scoreFn: (results) => {
        const first = results[0]
        let score = results.score
        if (first && first.target.startsWith("/" + q)) score *= 2
        return score
      },
    })
    return result.map((r) => r.obj)
  })

  // Reset selection when the filter changes
  createEffect(() => {
    filter()
    setStore("selected", 0)
  })

  function move(direction: -1 | 1) {
    if (!store.visible) return
    const list = options()
    if (!list.length) return
    let next = store.selected + direction
    if (next < 0) next = list.length - 1
    if (next >= list.length) next = 0
    moveTo(next)
  }

  function moveTo(next: number) {
    setStore("selected", next)
    if (!scroll) return
    const viewportHeight = Math.min(height(), options().length)
    const scrollBottom = scroll.scrollTop + viewportHeight
    if (next < scroll.scrollTop) {
      scroll.scrollBy(next - scroll.scrollTop)
    } else if (next + 1 > scrollBottom) {
      scroll.scrollBy(next + 1 - scrollBottom)
    }
  }

  function select() {
    const selected = options()[store.selected]
    if (!selected) return
    // Strip the `/<typed>` from the textarea so the dialog opens on a clean
    // slate (mirrors the main Prompt's behavior when running a slash cmd).
    const inp = props.input()
    if (inp) {
      const cursor = inp.logicalCursor
      inp.deleteRange(0, 0, cursor.row, cursor.col)
    }
    hide()
    selected.onSelect()
  }

  useBindings(() => ({
    target: props.input,
    enabled: () => store.visible,
    bindings: [
      { key: "up", desc: "Previous command", group: "KiloClaw", cmd: () => move(-1) },
      { key: "ctrl+p", desc: "Previous command", group: "KiloClaw", cmd: () => move(-1) },
      { key: "down", desc: "Next command", group: "KiloClaw", cmd: () => move(1) },
      { key: "ctrl+n", desc: "Next command", group: "KiloClaw", cmd: () => move(1) },
      { key: "escape", desc: "Hide autocomplete", group: "KiloClaw", cmd: hide },
      { key: "return", desc: "Select command", group: "KiloClaw", cmd: select },
      { key: "tab", desc: "Select command", group: "KiloClaw", cmd: select },
      {
        key: "right",
        fallthrough: true,
        cmd: () => {
          const input = props.input()
          if (input && input.cursorOffset <= store.index) hide()
        },
      },
    ],
  }))

  function show() {
    setStore({
      visible: true,
      index: props.input()?.cursorOffset ?? 0,
    })
  }

  function dismiss() {
    if (!store.visible) return
    setStore("visible", false)
  }

  function hide() {
    dismiss()
  }

  onMount(() => {
    props.ref({
      get visible() {
        return store.visible
      },
      dismiss() {
        dismiss()
      },
      onInput(value) {
        const inp = props.input()
        if (!inp) return
        if (store.visible) {
          // Hide if cursor moved before trigger, whitespace appeared between
          // trigger and cursor, or the input ceased being a single token.
          if (
            inp.cursorOffset <= store.index ||
            inp.getTextRange(store.index, inp.cursorOffset).match(/\s/) ||
            value.match(/^\S+\s+\S+\s*$/)
          ) {
            hide()
          }
          return
        }
        // Auto-reopen after backspace deletes a leading space, etc.
        const offset = inp.cursorOffset
        if (offset === 0) return
        if (value.startsWith("/") && !value.slice(0, offset).match(/\s/)) {
          show()
          setStore("index", 0)
        }
      },
      onCursorChange() {
        if (!store.visible) return
        const inp = props.input()
        if (!inp) return
        const cursor = inp.cursorOffset
        const value = inp.plainText
        if (
          cursor <= store.index ||
          inp.getTextRange(store.index, cursor).match(/\s/) ||
          value.match(/^\S+\s+\S+\s*$/)
        ) {
          hide()
        }
      },
    })
  })

  const height = createMemo(() => {
    const count = options().length || 1
    if (!store.visible) return Math.min(10, count)
    positionTick()
    const a = props.anchor()
    return Math.min(10, count, Math.max(1, a?.y ?? 1))
  })

  let scroll: ScrollBoxRenderable

  return (
    <box
      visible={store.visible}
      position="absolute"
      top={position().y - height()}
      left={position().x}
      width={position().width}
      zIndex={100}
      {...SplitBorder}
      borderColor={theme.border}
    >
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        backgroundColor={theme.backgroundMenu}
        height={height()}
        scrollbarOptions={{ visible: false }}
      >
        <Index
          each={options()}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>No matching commands</text>
            </box>
          }
        >
          {(option, index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index === store.selected ? theme.primary : undefined}
              flexDirection="row"
              onMouseDown={() => moveTo(index)}
              onMouseUp={() => select()}
            >
              <text fg={index === store.selected ? selectedForeground(theme) : theme.text} flexShrink={0}>
                {option().display}
              </text>
              <Show when={option().description}>
                <text fg={index === store.selected ? selectedForeground(theme) : theme.textMuted} wrapMode="none">
                  {" "}
                  {option().description}
                </text>
              </Show>
            </box>
          )}
        </Index>
      </scrollbox>
    </box>
  )
}
