/**
 * Hook for slash command detection and selection in the chat input.
 * When the user types "/" at the start of the input, shows a filtered
 * list of available commands (workflows, skills, MCP prompts).
 */

import { createSignal, createMemo } from "solid-js"
import type { Accessor } from "solid-js"
import type { CommandInfo } from "../types/messages"

export interface SlashCommand {
  show: Accessor<boolean>
  filtered: Accessor<CommandInfo[]>
  index: Accessor<number>
  setIndex: (i: number) => void
  onInput: (val: string) => void
  onKeyDown: (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => boolean
  close: () => void
}

export function useSlashCommand(commands: Accessor<CommandInfo[]>): SlashCommand {
  const [query, setQuery] = createSignal<string | null>(null)
  const [index, setIndex] = createSignal(0)

  const show = () => query() !== null

  const filtered = createMemo(() => {
    const q = query()
    if (q === null) return []
    const lower = q.toLowerCase()
    return commands().filter(
      (cmd) => cmd.name.toLowerCase().includes(lower) || (cmd.description ?? "").toLowerCase().includes(lower),
    )
  })

  const close = () => {
    setQuery(null)
    setIndex(0)
  }

  const onInput = (val: string) => {
    if (val.startsWith("/") && !val.slice(1).includes(" ")) {
      setQuery(val.slice(1))
      setIndex(0)
      return
    }
    close()
  }

  const select = (
    cmd: CommandInfo,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const newText = `/${cmd.name} `
    setText(newText)
    if (textarea) {
      textarea.value = newText
      const cursor = newText.length
      textarea.setSelectionRange(cursor, cursor)
      textarea.focus()
    }
    close()
    onSelect?.()
  }

  const onKeyDown = (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ): boolean => {
    if (!show()) return false

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setIndex((i) => (filtered().length === 0 ? 0 : Math.min(i + 1, filtered().length - 1)))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const cmd = filtered()[index()]
      if (!cmd) return false
      e.preventDefault()
      select(cmd, textarea, setText, onSelect)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      close()
      return true
    }

    return false
  }

  return {
    show,
    filtered,
    index,
    setIndex,
    onInput,
    onKeyDown,
    close,
  }
}
