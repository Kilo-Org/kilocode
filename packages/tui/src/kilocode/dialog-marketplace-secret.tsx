import { BoxRenderable } from "@opentui/core"
import { createSignal, onCleanup, onMount } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout } from "../ui/dialog"

/** Keep the real value out of editor buffers, selections and terminal frames. */
export function DialogMarketplaceSecret(props: {
  title: string
  description: string
  placeholder?: string
  onConfirm: (value: string) => void
}) {
  const theme = useTheme().surface("dialog")
  const [target, setTarget] = createSignal<BoxRenderable>()
  const [length, setLength] = createSignal(0)
  const [overflow, setOverflow] = createSignal(false)
  const limit = 4096
  let value: string[] = []
  let cursor = 0

  function insert(text: string) {
    const characters: string[] = []
    for (const character of text) {
      if (character === "\r" || character === "\n") continue
      if (value.length + characters.length === limit) {
        setOverflow(true)
        return
      }
      characters.push(character)
    }
    value = value.slice(0, cursor).concat(characters, value.slice(cursor))
    cursor += characters.length
    setLength(value.length)
    setOverflow(false)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    target,
    priority: 1,
    commands: [
      {
        bind: "enter",
        title: "Submit secret",
        group: "Dialog",
        run: () => props.onConfirm(value.join("")),
      },
      {
        bind: "ctrl+u",
        title: "Clear secret",
        group: "Dialog",
        run: () => {
          value = []
          cursor = 0
          setLength(0)
          setOverflow(false)
        },
      },
    ],
  }))

  onMount(() => target()?.focus())
  onCleanup(() => {
    value = []
  })

  return (
    <DialogLayout
      header={<DialogHeader title={props.title} />}
      footer={{
        actions: { primary: [{ title: "submit", key: "enter", onTrigger: () => props.onConfirm(value.join("")) }] },
      }}
    >
      <box gap={1}>
        <text fg={theme.text.muted}>{props.description}</text>
        <box
          id="marketplace-secret"
          ref={setTarget}
          focusable
          height={1}
          onKeyDown={(event) => {
            if (event.ctrl || event.meta || event.option) return
            if (event.name === "left") cursor = Math.max(0, cursor - 1)
            if (event.name === "right") cursor = Math.min(value.length, cursor + 1)
            if (event.name === "home") cursor = 0
            if (event.name === "end") cursor = value.length
            if (event.name === "backspace" && cursor > 0) {
              value.splice(--cursor, 1)
              setOverflow(false)
            }
            if (event.name === "delete") {
              value.splice(cursor, 1)
              setOverflow(false)
            }
            if (event.sequence && !/[\x00-\x1f\x7f]/.test(event.sequence)) insert(event.sequence)
            setLength(value.length)
            event.preventDefault()
          }}
          onPaste={(event) => {
            event.preventDefault()
            insert(new TextDecoder().decode(event.bytes))
          }}
        >
          <text selectable={false} fg={length() ? theme.text.formfield.base : theme.text.muted}>
            {length() ? "*".repeat(Math.min(length(), 32)) : (props.placeholder ?? "Enter secret")}
          </text>
        </box>
        <text fg={theme.text.muted}>Input hidden. ctrl+u clears; esc / ctrl+c cancels.</text>
        <text fg={overflow() ? theme.text.feedback.error.base : theme.text.muted}>
          {overflow() ? `Limit: ${limit} characters. Input not added.` : `${length()}/${limit} characters`}
        </text>
      </box>
    </DialogLayout>
  )
}
