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

  // kilocode_change start
  const baseMs = 500
  const maxMs = 5000
  const maxRetries = 12
  const timeouts = new Set<number>()

  const clearTimeouts = () => {
    for (const timeout of timeouts) {
      clearTimeout(timeout)
    }
    timeouts.clear()
  }

  const tick = (delay: number, retry: number) => {
    const timeout = setTimeout(() => {
      timeouts.delete(timeout)
      if (!loading()) return
      if (retry >= maxRetries) {
        const msg = "Timed out loading commands"
        setError(msg)
        setLoading(false)
        showToast({
          variant: "error",
          title: "Failed to load commands",
          description: msg,
        })
        return
      }
      vscode.postMessage({ type: "requestCommands" })
      tick(Math.min(delay * 2, maxMs), retry + 1)
    }, delay)
    timeouts.add(timeout)
  }

  const startRetry = () => {
    clearTimeouts()
    setLoading(true)
    setError(undefined)
    vscode.postMessage({ type: "requestCommands" })
    tick(baseMs, 1)
  }

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
      return
    }
    // Re-request commands when backend (re)connects, in case the retry window expired
    if (message.type === "ready" || (message.type === "connectionState" && message.state === "connected")) {
      if (loading() || error()) {
        startRetry()
      }
    }
  })

  onCleanup(unsubscribe)

  startRetry()

  onCleanup(clearTimeouts)
  // kilocode_change end

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
