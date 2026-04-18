import { createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { SlashCommandInfo, WebviewMessage, ExtensionMessage } from "../types/messages"

export const SLASH_PATTERN = /^\/(\S*)$/

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface SlashCommandEntry extends SlashCommandInfo {
  action?: () => void
}

export interface SlashCommand {
  results: Accessor<SlashCommandEntry[]>
  index: Accessor<number>
  show: Accessor<boolean>
  commands: Accessor<SlashCommandEntry[]>
  onInput: (val: string, cursor: number) => void
  onKeyDown: (
    e: KeyboardEvent,
    textarea: HTMLTextAreaElement | undefined,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => boolean
  select: (
    cmd: SlashCommandEntry,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => void
  setIndex: (index: number) => void
  close: () => void
}

export function useSlashCommand(vscode: VSCodeContext, exclude?: Set<string>): SlashCommand {
  const [server, setServer] = createSignal<SlashCommandInfo[]>([])
  const [query, setQuery] = createSignal<string | null>(null)
  const [index, setIndex] = createSignal(0)
  const [requested, setRequested] = createSignal(false)

  const all: SlashCommandEntry[] = [
    {
      name: "new",
      description: "Start a new session",
      hints: ["clear"],
      action: () => {
        window.dispatchEvent(new CustomEvent("newTaskRequest"))
        window.postMessage({ type: "navigate", view: "newTask" }, "*")
      },
    },
    {
      name: "sessions",
      description: "Switch to another session",
      hints: ["resume", "continue", "history"],
      action: () => {
        window.postMessage({ type: "navigate", view: "history" }, "*")
      },
    },
    {
      name: "models",
      description: "Switch the AI model",
      hints: [],
      action: () => {
        window.dispatchEvent(new CustomEvent("openModelPicker"))
      },
    },
    {
      name: "agents",
      description: "Switch the agent mode",
      hints: ["modes"],
      action: () => {
        window.dispatchEvent(new CustomEvent("openModePicker"))
      },
    },
    {
      name: "help",
      description: "Open help documentation",
      hints: [],
      action: () => {
        vscode.postMessage({ type: "openExternal", url: "https://kilo.ai/docs" })
      },
    },
    {
      name: "compact",
      description: "Summarize and compact the session",
      hints: ["smol", "condense"],
      action: () => {
        window.dispatchEvent(new CustomEvent("compactSession"))
      },
    },
    {
      name: "settings",
      description: "Open settings",
      hints: [],
      action: () => {
        vscode.postMessage({ type: "openSettingsPanel" })
      },
    },
    {
      name: "remote",
      description: "Toggle remote control",
      hints: [],
      action: () => {
        vscode.postMessage({ type: "toggleRemote" })
      },
    },
  ]

  const client = exclude ? all.filter((c) => !exclude.has(c.name)) : all

  const commands = (): SlashCommandEntry[] => {
    const names = new Set(client.map((c) => c.name))
    const filtered = server().filter((c) => !names.has(c.name))
    return [...client, ...filtered]
  }

  const show = () => query() !== null

  const request = () => {
    if (requested()) return
    setRequested(true)
    vscode.postMessage({ type: "requestCommands" })
  }

  const results = () => {
    const q = query()
    if (q === null) return []
    const all = commands()
    if (!q) return all
    const lower = q.toLowerCase()
    return all.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lower) ||
        cmd.description?.toLowerCase().includes(lower) ||
        cmd.hints.some((h) => h.toLowerCase().includes(lower)),
    )
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type !== "commandsLoaded") return
    setServer(message.commands)
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
      request()
      setQuery(match[1])
      setIndex(0)
    } else {
      close()
    }
  }

  const select = (
    cmd: SlashCommandEntry,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    if (cmd.action) {
      textarea.value = ""
      setText("")
      close()
      onSelect?.()
      cmd.action()
      return
    }
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
    if (e.isComposing) return false

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
      e.stopPropagation()
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
