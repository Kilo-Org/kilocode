import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import {
  batch,
  createContext,
  createEffect,
  For,
  onCleanup,
  Show,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"
import { Keymap } from "../context/keymap"
import { ThemeContextProvider, useTheme } from "../context/theme"
import { InputRenderable, MouseButton, Renderable, RGBA, TextAttributes } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useToast } from "./toast"
import { useClipboard } from "../context/clipboard"
import { useConfig } from "../config"
import { copy, copyOnSelectRelease } from "../util/selection"

export type DialogSize = "medium" | "large" | "xlarge"

export const DIALOG_INSET = 3
// List rows reserve a 1-cell gutter for the ▌ bar / ● marker.
export const DIALOG_LIST_INSET = DIALOG_INSET + 1

export function dialogWidth(size: DialogSize) {
  if (size === "xlarge") return 116
  if (size === "large") return 88
  return 60
}

export function Dialog(
  props: ParentProps<{
    size?: DialogSize
    centered?: boolean
    onClose: () => void
  }>,
) {
  const dimensions = useTerminalDimensions()
  const theme = useTheme().surface("dialog")
  const renderer = useRenderer()

  let dismiss = false
  return (
    <ThemeContextProvider context="dialog">
      <box
        onMouseDown={() => {
          dismiss = !!renderer.getSelection()
        }}
        onMouseUp={() => {
          if (dismiss) {
            dismiss = false
            return
          }
          props.onClose?.()
        }}
        width={dimensions().width}
        height={dimensions().height}
        alignItems="center"
        justifyContent={props.centered ? "center" : undefined}
        position="absolute"
        zIndex={3000}
        paddingTop={props.centered ? 0 : dimensions().height / 4}
        left={0}
        top={0}
        backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
      >
        <box
          onMouseUp={(e: { stopPropagation(): void }) => {
            // A selection release must bubble up to the copy-on-select handler in
            // DialogProvider; the backdrop's dismiss flag keeps it from closing the dialog.
            if (renderer.getSelection()?.getSelectedText()) return
            dismiss = false
            e.stopPropagation()
          }}
          width={dialogWidth(props.size ?? "medium")}
          maxWidth={dimensions().width - 2}
          backgroundColor={theme.background.base}
          paddingTop={1}
        >
          {props.children}
        </box>
      </box>
    </ThemeContextProvider>
  )
}

export function DialogHeader(
  props: ParentProps<{
    title?: JSX.Element
    titleView?: JSX.Element
    closeLabel?: string
    onClose?: () => void
    gap?: number
  }>,
) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  return (
    <box flexDirection="row" justifyContent="space-between" gap={props.gap}>
      {props.titleView ?? (
        <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
          {props.title}
        </text>
      )}
      {props.children}
      <text fg={theme.text.muted} flexShrink={0} onMouseUp={() => (props.onClose ?? dialog.clear)()}>
        {props.closeLabel ?? "esc"}
      </text>
    </box>
  )
}

/**
 * Standard dialog layout: header, body and an optional footer, one blank row between
 * each and one blank row at the bottom, with the shared side padding.
 */
export function DialogLayout(
  props: ParentProps<{
    id?: string
    /** Usually a `DialogHeader`. */
    header: JSX.Element
    /** Usually a `DialogFooter` or a row of buttons. */
    footer?: JSX.Element
    /** Side padding in cells. Defaults to DIALOG_INSET. */
    inset?: number
  }>,
) {
  const inset = () => props.inset ?? DIALOG_INSET
  return (
    <box id={props.id} paddingLeft={inset()} paddingRight={inset()} paddingBottom={1} gap={1}>
      {props.header}
      <box>{props.children}</box>
      {props.footer}
    </box>
  )
}

/** Stretches a raised band inside a `DialogLayout` across the side padding; its content re-applies `DIALOG_INSET`. */
export function DialogBleed(props: ParentProps) {
  return (
    <box marginLeft={-DIALOG_INSET} marginRight={-DIALOG_INSET}>
      {props.children}
    </box>
  )
}

export type DialogFooterAction = {
  title: string
  /** Literal key label, e.g. "enter". */
  key?: string
  /** Keymap command id whose first shortcut is shown when `key` is not set. The action hides when it has no shortcut. */
  command?: string
  onTrigger?: () => void
  side?: "left" | "right"
  disabled?: boolean
  /** Overrides the title color, e.g. for a "✓ copied" confirmation. */
  color?: RGBA
}

export function DialogFooter(
  props: ParentProps<{
    actions?: DialogFooterAction[]
    /** Side padding in cells, e.g. DIALOG_INSET or DIALOG_LIST_INSET. Omit when the parent already pads. */
    inset?: number
  }>,
) {
  const dimensions = useTerminalDimensions()
  const shortcuts = Keymap.useShortcuts()
  const narrow = () => dimensions().width < 60
  const actions = () =>
    (props.actions ?? []).flatMap((action) => {
      if (action.key !== undefined || action.command === undefined) return [action]
      const key = shortcuts.get(action.command)
      return key ? [{ ...action, key }] : []
    })
  const left = () => actions().filter((action) => action.side !== "right")
  const right = () => actions().filter((action) => action.side === "right")
  return (
    <box
      paddingLeft={props.inset}
      paddingRight={props.inset}
      flexDirection="row"
      justifyContent="space-between"
      flexShrink={0}
    >
      <box flexDirection={narrow() ? "column" : "row"} gap={narrow() ? 0 : 2}>
        {props.children}
        <For each={left()}>{(action) => <DialogFooterItem action={action} />}</For>
      </box>
      <box flexDirection="row" gap={2}>
        <For each={right()}>{(action) => <DialogFooterItem action={action} />}</For>
      </box>
    </box>
  )
}

function DialogFooterItem(props: { action: DialogFooterAction }) {
  const theme = useTheme().surface("dialog")
  return (
    <text
      onMouseUp={() => {
        if (props.action.disabled) return
        props.action.onTrigger?.()
      }}
    >
      <span
        style={{
          fg: props.action.disabled ? theme.text.action.primary.disabled : (props.action.color ?? theme.text.base),
        }}
      >
        {props.action.title}
      </span>
      <Show when={props.action.key}>
        <span style={{ fg: props.action.disabled ? theme.text.action.primary.disabled : theme.text.muted }}>
          {" " + props.action.key}
        </span>
      </Show>
    </text>
  )
}

function init() {
  const [store, setStore] = createStore({
    stack: [] as {
      element: () => JSX.Element
      onClose?: () => void
      key?: unknown
    }[],
    size: "medium" as DialogSize,
    centered: false,
  })

  const renderer = useRenderer()
  const keymap = Keymap.use()

  createEffect(() => {
    if (store.stack.length === 0) return
    const popMode = keymap.mode.push("modal")
    onCleanup(popMode)
  })

  let focus: Renderable | null
  function refocus() {
    setTimeout(() => {
      if (store.stack.length > 0) return
      if (!focus) return
      if (focus.isDestroyed) return
      function find(item: Renderable) {
        for (const child of item.getChildren()) {
          if (child === focus) return true
          if (find(child)) return true
        }
        return false
      }
      const found = find(renderer.root)
      if (!found) return
      focus.focus()
    }, 1)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: store.stack.length > 0,
    commands: [
      {
        bind: "escape",
        title: "Close dialog",
        group: "Dialog",
        run: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection()
            return
          }
          const current = store.stack.at(-1)
          current?.onClose?.()
          setStore("stack", store.stack.slice(0, -1))
          refocus()
        },
      },
      {
        bind: "ctrl+c",
        title: "Close dialog",
        group: "Dialog",
        run: () => {
          if (renderer.getSelection()) {
            renderer.clearSelection()
            return
          }
          const editor = renderer.currentFocusedEditor
          if (editor?.plainText) {
            if (editor instanceof InputRenderable) editor.value = ""
            else editor.setText("")
            return
          }
          const current = store.stack.at(-1)
          current?.onClose?.()
          setStore("stack", store.stack.slice(0, -1))
          refocus()
        },
      },
    ],
  }))

  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      batch(() => {
        setStore("size", "medium")
        setStore("centered", false)
        setStore("stack", [])
      })
      refocus()
    },
    replace(input: () => JSX.Element, onClose?: () => void, options?: { key?: unknown; size?: DialogSize }) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      batch(() => {
        setStore("size", options?.size ?? "medium")
        setStore("centered", false)
        setStore("stack", [
          {
            element: input,
            onClose,
            key: options?.key,
          },
        ])
      })
    },
    get stack() {
      return store.stack
    },
    get size() {
      return store.size
    },
    get centered() {
      return store.centered
    },
    get key() {
      return store.stack.at(-1)?.key
    },
    setSize(size: "medium" | "large" | "xlarge") {
      setStore("size", size)
    },
    setCentered(centered: boolean) {
      setStore("centered", centered)
    },
  }
}

export type DialogContext = ReturnType<typeof init>

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  const clipboard = useClipboard()
  const config = useConfig()
  const copyOnSelectEnabled = () =>
    (config.data.terminal?.copy ?? (process.platform === "win32" ? "manual" : "select")) === "select"

  return (
    <ctx.Provider value={value}>
      {props.children}
      <box
        position="absolute"
        zIndex={3000}
        onMouseDown={(evt: { button: number; preventDefault(): void; stopPropagation(): void }) => {
          if (copyOnSelectEnabled()) return
          if (evt.button !== MouseButton.RIGHT) return

          if (!copy(renderer, toast, clipboard)) return
          evt.preventDefault()
          evt.stopPropagation()
        }}
        onMouseUp={
          copyOnSelectEnabled() ? (event) => copyOnSelectRelease(event, renderer, toast, clipboard) : undefined
        }
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} size={value.size} centered={value.centered}>
            {/* Render each entry once: inserting the element function directly would re-run it, remounting
                the dialog with fresh state, whenever a signal it reads at its root (e.g. a top-level <Show>) changes. */}
            <Show when={value.stack.at(-1)} keyed>
              {(item) => item.element()}
            </Show>
          </Dialog>
        </Show>
      </box>
    </ctx.Provider>
  )
}

export function useDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}
