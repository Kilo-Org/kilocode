/**
 * Stack summary context
 * Fetches and exposes the configured technology list for the current project
 * directory so the chat prompt Stack popover can show whether a stack is set.
 *
 * Stack data lives only in the standalone Stack Builder panel; this context
 * mirrors the lightweight summary (`technologies` + `configured`) via a new
 * `requestStackSummary` / `stackSummaryLoaded` extension message path.
 */

import { createContext, useContext, createSignal, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage, StackSummaryTechnology } from "../types/messages"

export interface StackSummaryValue {
  technologies: Accessor<StackSummaryTechnology[]>
  configured: Accessor<boolean>
  projectDirectory: Accessor<string | undefined>
  loaded: Accessor<boolean>
  refresh: () => void
}

export const StackSummaryContext = createContext<StackSummaryValue>()

export const StackSummaryProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [technologies, setTechnologies] = createSignal<StackSummaryTechnology[]>([])
  const [configured, setConfigured] = createSignal(false)
  const [projectDirectory, setProjectDirectory] = createSignal<string | undefined>(undefined)
  const [loaded, setLoaded] = createSignal(false)

  // Register outside onMount so an early stackSummaryLoaded push is not missed.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "stackSummaryLoaded") return
    setTechnologies(message.technologies)
    setConfigured(message.configured)
    setProjectDirectory(message.projectDirectory)
    setLoaded(true)
  })
  onCleanup(unsubscribe)

  // Retry timer: if the extension's HTTP client isn't ready on first request,
  // re-request after a short delay so the chat doesn't stay empty.
  let retry: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    clearTimeout(retry)
    vscode.postMessage({ type: "requestStackSummary" })
    retry = setTimeout(() => {
      if (!loaded()) vscode.postMessage({ type: "requestStackSummary" })
    }, 1500)
  }
  onCleanup(() => clearTimeout(retry))

  refresh()

  const value: StackSummaryValue = { technologies, configured, projectDirectory, loaded, refresh }

  return <StackSummaryContext.Provider value={value}>{props.children}</StackSummaryContext.Provider>
}

export function useStackSummary(): StackSummaryValue {
  const context = useContext(StackSummaryContext)
  if (!context) throw new Error("useStackSummary must be used within StackSummaryProvider")
  return context
}
