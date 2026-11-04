/**
 * The slash-command menu of the New Worktree dialog.
 *
 * The dialog creates a session before the first prompt, so a submitted `/name` must route through the session command
 * endpoint instead of travelling as literal text. This menu offers the location's commands plus the dialog's own picks,
 * which open the model, agent, variant and project selectors.
 */
import { createSignal, type Accessor } from "solid-js"

export const SLASH_PATTERN = /^\/(\S*)$/

export interface DialogCommand {
  name: string
  description?: string
  source?: string
  hints?: string[]
  action?: () => void
  nested?: boolean
}

function score(command: DialogCommand, query: string) {
  const name = command.name.toLowerCase()
  if (name === query) return 3
  if (name.startsWith(query)) return 2
  if (name.includes(query)) return 1
  if (command.description?.toLowerCase().includes(query)) return 1
  if ((command.hints ?? []).some((hint) => hint.toLowerCase().includes(query))) return 1
  return 0
}

export function createDialogCommandMenu(opts: {
  commands: Accessor<DialogCommand[]>
  hidden: () => Set<string>
  extra?: DialogCommand[]
}) {
  const [query, setQuery] = createSignal<string | null>(null)
  const [index, setIndex] = createSignal(0)
  const [slashEnd, setSlashEnd] = createSignal<number | null>(null)
  const all = () => [...(opts.extra ?? []), ...opts.commands()].filter((command) => !opts.hidden().has(command.name))
  const show = () => query() !== null
  const results = () => {
    const value = query()
    if (value === null) return []
    const roots = all().filter((command) => !command.name.includes(" "))
    if (!value) return roots
    const lower = value.toLowerCase()
    const matches = roots.filter(
      (command) =>
        command.name.toLowerCase().includes(lower) ||
        command.description?.toLowerCase().includes(lower) ||
        (command.hints ?? []).some((hint) => hint.toLowerCase().includes(lower)),
    )
    return [...matches].sort((a, b) => score(b, lower) - score(a, lower))
  }

  const close = () => {
    setQuery(null)
    setSlashEnd(null)
  }

  const onInput = (value: string, cursor: number) => {
    const before = value.substring(0, cursor)
    const match = before.match(SLASH_PATTERN)
    if (!match) return close()
    setQuery(match[1] ?? "")
    setIndex(0)
    setSlashEnd(cursor)
  }

  const select = (
    command: DialogCommand,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const cursor = slashEnd() ?? textarea.selectionStart ?? 0
    const trailing = textarea.value.substring(cursor)
    if (command.action) {
      textarea.value = trailing
      setText(trailing)
      textarea.setSelectionRange(0, 0)
      close()
      onSelect?.()
      command.action()
      return
    }
    const text = `/${command.name} ${trailing}`
    textarea.value = text
    setText(text)
    textarea.setSelectionRange(text.length, text.length)
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
    if (!show() || e.isComposing) return false
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setIndex((current) => Math.min(current + 1, results().length - 1))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setIndex((current) => Math.max(current - 1, 0))
      return true
    }
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      const command = results()[index()]
      if (!command) return false
      e.preventDefault()
      if (textarea) select(command, textarea, setText, onSelect)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      close()
      return true
    }
    return false
  }

  return { results, index, show, commands: all, onInput, onKeyDown, select, setIndex, close }
}
