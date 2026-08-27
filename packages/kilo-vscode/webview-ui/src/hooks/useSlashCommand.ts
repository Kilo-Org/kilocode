import { createSignal, onCleanup } from "solid-js"
import type { Accessor } from "solid-js"
import type { SlashCommandInfo, WebviewMessage, ExtensionMessage } from "../types/messages"

export const SLASH_PATTERN = /^\/(\S*)$/

function getMatchScore(cmd: SlashCommandEntry, lower: string): number {
  const name = cmd.name.toLowerCase()
  if (name === lower) return 3
  if (name.startsWith(lower)) return 2
  if (name.includes(lower)) return 1
  if (cmd.description?.toLowerCase().includes(lower)) return 1
  if (cmd.hints.some((h) => h.toLowerCase().includes(lower))) return 1
  return 0
}

export function sortByScore(matches: SlashCommandEntry[], query: string): SlashCommandEntry[] {
  const lower = query.toLowerCase()
  return [...matches].sort((a, b) => getMatchScore(b, lower) - getMatchScore(a, lower))
}

interface VSCodeContext {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

export interface SlashCommandEntry extends SlashCommandInfo {
  action?: () => void
  enabled?: Accessor<boolean>
  nested?: boolean
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

export function useSlashCommand(
  vscode: VSCodeContext,
  sandbox: { action: () => void; enabled: Accessor<boolean> },
  exclude?: Set<string> | Accessor<Set<string>>,
  include?: Set<string> | Accessor<Set<string>>,
  scope?: string,
  extra?: SlashCommandEntry[],
): SlashCommand {
  const [server, setServer] = createSignal<SlashCommandInfo[]>([])
  const [query, setQuery] = createSignal<string | null>(null)
  const [index, setIndex] = createSignal(0)
  const [requested, setRequested] = createSignal(false)
  const [slashEnd, setSlashEnd] = createSignal<number | null>(null)
  const open = (name: string) => {
    window.dispatchEvent(new CustomEvent(name, { detail: { source: scope } }))
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
      hints: ["model"],
      action: () => {
        open("openModelPicker")
      },
    },
    {
      name: "agents",
      description: "Switch the agent mode",
      hints: ["modes"],
      action: () => {
        open("openModePicker")
      },
    },
    {
      name: "variant",
      description: "Switch the reasoning effort",
      hints: ["variants", "reasoning", "thinking"],
      action: () => {
        open("openVariantPicker")
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
      name: "memory",
      description: "Manage project memory",
      hints: ["mem"],
      nested: true,
    },
    { name: "memory status", description: "Show project memory status", hints: [] },
    { name: "memory show", description: "Show stored project memory", hints: [] },
    { name: "memory on", description: "Enable project memory", hints: [] },
    { name: "memory off", description: "Disable project memory", hints: [] },
    { name: "memory inspect", description: "Reveal the project memory folder", hints: [] },
    { name: "memory rebuild", description: "Rebuild the memory index", hints: [] },
    { name: "memory remember", description: "Save a project memory note", hints: [] },
    { name: "memory correct", description: "Save a correction to project memory", hints: [] },
    { name: "memory forget", description: "Remove matching project memory", hints: [] },
    { name: "memory auto on", description: "Enable automatic memory saves", hints: [] },
    { name: "memory auto off", description: "Disable automatic memory saves", hints: [] },
    { name: "memory purge confirm", description: "Delete all project memory files", hints: [] },
    {
      name: "review",
      description: "Review code changes [uncommitted, staged, unpushed, branch, commit, pr]",
      hints: ["code-review", "diff"],
      nested: true,
    },
    { name: "review uncommitted", description: "Review uncommitted changes (staged, unstaged, untracked)", hints: [] },
    { name: "review staged", description: "Review staged changes only", hints: [] },
    { name: "review unpushed", description: "Review local commits ahead of upstream", hints: [] },
    { name: "review branch", description: "Review current branch against base branch", hints: [] },
    {
      name: "review worktree",
      description: "Review committed and uncommitted worktree changes against its base",
      hints: [],
    },
    {
      name: "review quick",
      description: "Fast single-pass review with minimal token usage",
      hints: ["--quick", "fast"],
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
    {
      name: "kiloclaw",
      description: "Open KiloClaw chat",
      hints: ["claw"],
      action: () => {
        vscode.postMessage({ type: "openKiloClaw" })
      },
    },
    {
      name: "sandbox",
      description: "Toggle sandbox",
      hints: [],
      action: sandbox.action,
      enabled: sandbox.enabled,
    },
    {
      name: "reload",
      description: "Reload config, skills, agents, and commands from disk",
      hints: ["refresh"],
      action: () => {
        vscode.postMessage({ type: "reload" })
      },
    },
  ]
  all.push(...(extra ?? []))

  const excluded = () => {
    if (typeof exclude === "function") return exclude()
    return exclude
  }

  const included = () => {
    if (typeof include === "function") return include()
    return include
  }

  const client = () => {
    const set = excluded()
    const only = included()
    return all.filter((c) => !set?.has(c.name) && (!only || only.has(c.name)))
  }

  const commands = (): SlashCommandEntry[] => {
    const list = client()
    const names = new Set(list.map((c) => c.name))
    const set = excluded()
    const only = included()
    const filtered = server().filter((c) => !names.has(c.name) && !set?.has(c.name) && (!only || only.has(c.name)))
    return [...list, ...filtered]
  }

  const show = () => query() !== null

  const request = () => {
    if (requested()) return
    setRequested(true)
    vscode.postMessage({ type: "requestCommands" })
  }

  const matched = () => {
    const q = query()
    if (q === null) return []
    const list = commands()
    if (q.startsWith("memory ")) {
      const matches = list.filter((cmd) => cmd.name.startsWith("memory "))
      if (q === "memory ") return matches
      const lower = q.toLowerCase()
      return sortByScore(
        matches.filter((cmd) => cmd.name.toLowerCase().startsWith(lower)),
        lower,
      )
    }
    if (q.startsWith("review ")) {
      const matches = list.filter((cmd) => cmd.name.startsWith("review "))
      if (q === "review ") return matches
      const lower = q.toLowerCase()
      return sortByScore(
        matches.filter((cmd) => cmd.name.toLowerCase().startsWith(lower)),
        lower,
      )
    }
    const root = list.filter((cmd) => !cmd.name.includes(" "))
    if (!q) return root
    const lower = q.toLowerCase()
    const matches = root.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lower) ||
        cmd.description?.toLowerCase().includes(lower) ||
        cmd.hints.some((h) => h.toLowerCase().includes(lower)),
    )
    return sortByScore(matches, lower)
  }

  const results = () => {
    const list = matched()
    // PromptInput renders contiguous Actions and Commands groups, so keyboard indexes must use the same order.
    return [...list.filter((cmd) => cmd.action), ...list.filter((cmd) => !cmd.action)]
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
    setSlashEnd(null)
  }

  const onInput = (val: string, cursor: number) => {
    const before = val.substring(0, cursor)
    const match = before.match(SLASH_PATTERN)
    if (match) {
      request()
      setQuery(match[1])
      setIndex(0)
      setSlashEnd(cursor)
      return
    }
    const memory = before.match(/^\/(?:memory|mem)\s+([^\n]*)$/i)
    if (memory) {
      const value = `memory ${memory[1]}`.toLowerCase()
      if (!commands().some((cmd) => cmd.name.toLowerCase().startsWith(value))) return close()
      request()
      setQuery(value)
      setIndex(0)
      setSlashEnd(cursor)
      return
    }
    const review = before.match(/^\/review\s+([^\n]*)$/i)
    if (review) {
      const value = `review ${review[1]}`.toLowerCase()
      if (!commands().some((cmd) => cmd.name.toLowerCase().startsWith(value))) return close()
      request()
      setQuery(value)
      setIndex(0)
      setSlashEnd(cursor)
      return
    }
    return close()
  }

  const select = (
    cmd: SlashCommandEntry,
    textarea: HTMLTextAreaElement,
    setText: (text: string) => void,
    onSelect?: () => void,
  ) => {
    const cursor = slashEnd() ?? textarea.selectionStart ?? 0
    // trailingText holds text after the slash command.
    // slashEnd is the cursor position from onInput when the slash pattern was matched.
    const trailingText = textarea.value.substring(cursor)

    if (cmd.action) {
      if (cmd.enabled && !cmd.enabled()) return
      textarea.value = trailingText
      setText(trailingText)
      textarea.setSelectionRange(0, 0)
      close()
      onSelect?.()
      cmd.action()
      return
    }
    const commandText = `/${cmd.name} `
    const updatedText = commandText + trailingText
    textarea.value = updatedText
    setText(updatedText)
    textarea.setSelectionRange(commandText.length, commandText.length)
    textarea.focus()
    if (cmd.nested) {
      setQuery(`${cmd.name} `)
      setIndex(0)
      setSlashEnd(commandText.length)
    }
    if (!cmd.nested) close()
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
