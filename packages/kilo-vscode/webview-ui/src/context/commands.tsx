/**
 * Commands context
 * Fetches and exposes the list of available commands (workflows, skills, MCP prompts)
 * from the CLI backend.
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { CommandInfo, ExtensionMessage } from "../types/messages"

interface CommandsContextValue {
  commands: Accessor<CommandInfo[]>
  loading: Accessor<boolean>
}

const CommandsContext = createContext<CommandsContextValue>()

export const CommandsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  const [commands, setCommands] = createSignal<CommandInfo[]>([])
  const [loading, setLoading] = createSignal(true)

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "commandsLoaded") {
      setCommands(message.commands)
      setLoading(false)
    }
  })

  onCleanup(unsubscribe)

  const retryMs = 500

  vscode.postMessage({ type: "requestCommands" })

  const retryTimer = setInterval(() => {
    if (!loading()) {
      clearInterval(retryTimer)
      return
    }
    vscode.postMessage({ type: "requestCommands" })
  }, retryMs)

  onCleanup(() => clearInterval(retryTimer))

  const value: CommandsContextValue = {
    commands,
    loading,
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
