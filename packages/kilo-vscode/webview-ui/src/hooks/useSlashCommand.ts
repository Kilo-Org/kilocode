import { createEffect, createSignal, on, onCleanup } from "solid-js"
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
  resolve: (text: string) => { command: SlashCommandEntry; arguments: string } | undefined
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

interface SlashCommandOptions {
  sessionID?: Accessor<string | undefined>
}

export function useSlashCommand(
  vscode: VSCodeContext,
  exclude?: Set<string> | Accessor<Set<string>>,
  opts?: SlashCommandOptions,
): SlashCommand {
  const [catalogs, setCatalogs] = createSignal(new Map<string, SlashCommandInfo[]>())
  const [query, setQuery] = createSignal<string | null>(null)
  const [index, setIndex] = createSignal(0)
  const requested = new Set<string>()
  const ids = new Map<string, number>()
  const scope = () => opts?.sessionID?.()
  const key = (id?: string) => (id ? `session:${id}` : "local")
  const server = () => catalogs().get(opts?.sessionID ? key(scope()) : "local") ?? []

  if (opts?.sessionID) {
    createEffect(
      on(
        scope,
        () => {
          requested.clear()
          setQuery(null)
        },
        { defer: true },
      ),
    )
  }

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
      name: "variant",
      description: "Switch the reasoning effort",
      hints: ["variants", "reasoning", "thinking"],
      action: () => {
        window.dispatchEvent(new CustomEvent("openVariantPicker"))
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
      name: "export",
      description: "Export the current session transcript as Markdown",
      hints: ["markdown", "transcript"],
      action: () => {
        window.dispatchEvent(new CustomEvent("exportSessionTranscript"))
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

  const excluded = () => {
    if (typeof exclude === "function") return exclude()
    return exclude
  }

  const client = () => {
    if (opts?.sessionID) return []
    const set = excluded()
    if (!set) return all
    return all.filter((c) => !set.has(c.name))
  }

  const commands = (): SlashCommandEntry[] => {
    const list = client()
    const names = new Set(list.map((c) => c.name))
    const set = excluded()
    const filtered = server().filter((c) => !names.has(c.name) && !set?.has(c.name))
    return [...list, ...filtered]
  }

  const show = () => query() !== null

  const resolve = (text: string) => {
    const match = text.match(/^\/(\S+)/)
    const word = match?.[1]
    if (!match || !word) return
    const command =
      commands().find((command) => command.name === word) ?? commands().find((command) => command.hints.includes(word))
    if (!command) return
    return { command, arguments: text.slice(match[0].length).trim() }
  }

  const request = () => {
    const id = scope()
    if (opts?.sessionID && !id) return
    const current = opts?.sessionID ? key(id) : "local"
    if (requested.has(current)) return
    requested.add(current)
    const requestID = opts?.sessionID ? (ids.get(current) ?? 0) + 1 : undefined
    if (requestID) ids.set(current, requestID)
    vscode.postMessage({ type: "requestCommands", ...(id ? { sessionID: id, requestID } : {}) })
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
    if (opts?.sessionID ? !message.sessionID : message.sessionID) return
    const current = opts?.sessionID ? key(message.sessionID) : "local"
    if (opts?.sessionID && message.requestID !== ids.get(current)) return
    setCatalogs((catalogs) => new Map(catalogs).set(current, message.commands))
  })

  onCleanup(() => {
    unsubscribe()
  })

  const close = () => {
    setQuery(null)
    if (opts?.sessionID) requested.clear()
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
    resolve,
    onInput,
    onKeyDown,
    select,
    setIndex,
    close,
  }
}
