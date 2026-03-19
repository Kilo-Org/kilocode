import { createSignal, onCleanup, onMount } from "solid-js"
import type { Accessor } from "solid-js"
import type { SlashCommandInfo, WebviewMessage, ExtensionMessage } from "../types/messages"

export const SLASH_PATTERN = /^\/(\S*)$/

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface SlashCommand {
  results: Accessor<SlashCommandInfo[]>
  index: Accessor<number>
  show: Accessor<boolean>
  commands: Accessor<SlashCommandInfo[]>
  onInput: (val: string, cursor: number) => void
  onKeyDown: (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => boolean
  select: (
    cmd: SlashCommandInfo,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
  setIndex: (index: number) => void
  close: () => void
}

export function useSlashCommand(vscode: VSCodeContext): SlashCommand {
  const [commands, setCommands] = createSignal<SlashCommandInfo[]>([])
  const [query, setQuery] = createSignal<string | null>(null)
  const [index, setIndex] = createSignal(0)

  const show = () => query() !== null

  const results = () => {
    const q = query()
    if (q === null) return []
    const all = commands()
    if (!q) return all
    const lower = q.toLowerCase()
    return all.filter((cmd) => cmd.name.toLowerCase().includes(lower) || cmd.description?.toLowerCase().includes(lower))
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "commandsLoaded") return
    setCommands(message.commands)
  })

  onMount(() => {
    vscode.postMessage({ type: "requestCommands" })
  })

  onCleanup(() => {
    unsubscribe()
  })

  const close = () => {
    setQuery(null)
  }

  const onInput = (val: string, cursor: number) => {
    const before = val.substring(0, cursor)
    const match = before.match(SLASH_PATTERN)
    if (match) {
      setQuery(match[1])
      setIndex(0)
    } else {
      close()
    }
  }

  const select = (
    cmd: SlashCommandInfo,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const text = `/${cmd.name} `
    textarea.value = text
    setText(text)
    const pos = text.length
    textarea.setSelectionRange(pos, pos)
    textarea.focus()
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

    const filtered = results()

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, filtered.length - 1))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const cmd = filtered[index()]
      if (!cmd) return false
      e.preventDefault()
      if (textarea) select(cmd, textarea, setText, onSelect)
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
    results,
    index,
    show,
    commands,
    onInput,
    onKeyDown,
    select,
    setIndex,
    close,
  }
}
