/**
 * Commands context
 * Fetches and exposes the list of available commands (workflows, skills, MCP prompts)
 * from the CLI backend.
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent, Accessor } from "solid-js"
import { showToast } from "@kilocode/kilo-ui/toast"
import { useVSCode } from "./vscode"
import type { CommandInfo, ExtensionMessage } from "../types/messages"

interface CommandsContextValue {
  commands: Accessor<CommandInfo[]>
  loading: Accessor<boolean>
  error: Accessor<string | undefined>
}

const CommandsContext = createContext<CommandsContextValue>()

export const CommandsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [commands, setCommands] = createSignal<CommandInfo[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | undefined>()

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "commandsLoaded") {
      setCommands(message.commands)
      setError(message.error)
      setLoading(false)
      if (message.error) {
        showToast({
          variant: "error",
          title: "Failed to load commands",
          description: message.error,
        })
      }
    }
  })

  onCleanup(unsubscribe)

  const baseMs = 500
  const maxMs = 5000
  const maxRetries = 12 // kilocode_change
  // kilocode_change start
  const timeouts = new Set<number>()
  const tick = (delay: number, retry: number) => {
    const timeout = setTimeout(() => {
      timeouts.delete(timeout)
      if (!loading()) {
        return
      }
      if (retry >= maxRetries) {
        const message = "Timed out loading commands"
        setError(message)
        setLoading(false)
        showToast({
          variant: "error",
          title: "Failed to load commands",
          description: message,
        })
        return
      }
      vscode.postMessage({ type: "requestCommands" })
      tick(Math.min(delay * 2, maxMs), retry + 1)
    }, delay)
    timeouts.add(timeout)
  }
  tick(baseMs, 1)
  // kilocode_change end

  vscode.postMessage({ type: "requestCommands" })

  onCleanup(() => {
    for (const timeout of timeouts) {
      clearTimeout(timeout)
    }
    timeouts.clear() // kilocode_change
  })

  const value: CommandsContextValue = {
    commands,
    loading,
    error,
  }

  return <CommandsContext.Provider value={value}>{props.children}</CommandsContext.Provider>
}

export function useCommands(): CommandsContextValue {
  const context = useContext(CommandsContext)
  if (!context) {
    throw new Error("useCommands must be used within a CommandsProvider")
  }
  return context
}
