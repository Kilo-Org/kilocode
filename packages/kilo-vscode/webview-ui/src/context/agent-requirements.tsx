/** @jsxImportSource solid-js */

import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import { useConfig } from "./config"
import { useServer } from "./server"
import { useSession } from "./session"
import { useVSCode } from "./vscode"
import type { AgentRequirementInstall, AgentRequirementResult } from "../types/messages"

export interface AgentRequirementsContextValue {
  result: Accessor<AgentRequirementResult | undefined>
  installs: Accessor<AgentRequirementInstall[]>
  checking: Accessor<boolean>
  installing: Accessor<boolean>
  blocked: Accessor<boolean>
  visible: Accessor<boolean>
  retry: () => void
  installAll: () => void
}

export const AgentRequirementsContext = createContext<AgentRequirementsContextValue>()

export const AgentRequirementsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const session = useSession()
  const server = useServer()
  const config = useConfig()
  const [result, setResult] = createSignal<AgentRequirementResult>()
  const [installs, setInstalls] = createSignal<AgentRequirementInstall[]>([])
  const [revision, setRevision] = createSignal(0)
  let requested = ""
  let preserve = ""
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  const enabled = () => config.config().experimental?.agent_requirements === true
  const agent = () => session.selectedAgent()
  const directory = () => server.workspaceDirectory()
  const key = () => `${directory()}\0${agent()}`
  // Ignore responses for an agent or directory that is no longer selected.
  const active = (value: { agent: string; directory: string }) =>
    value.agent === agent() && value.directory === directory()

  // Retry checks that may be sent before the extension is ready.
  const request = (force = false) => {
    if (!enabled() || !agent() || !directory()) return
    if (retryTimer) clearTimeout(retryTimer)
    vscode.postMessage({
      type: "requestAgentRequirements",
      agent: agent(),
      directory: directory(),
      sessionID: session.currentSessionID(),
      force,
    })
    retryTimer = setTimeout(() => {
      if (!result() && enabled()) request(force)
    }, 1_000)
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "agentRequirementsLoaded") {
      if (!active(message.result)) return
      if (retryTimer) clearTimeout(retryTimer)
      setResult(message.result)
      return
    }
    if (message.type === "agentRequirementsInstallProgress") {
      if (!active(message)) return
      setInstalls(message.installs)
      return
    }
    if (message.type === "agentRequirementsInvalidated") {
      requested = ""
      preserve = installs().some((item) => item.status === "failed") ? key() : ""
      if (retryTimer) clearTimeout(retryTimer)
      setRevision((value) => value + 1)
      return
    }
    if (message.type !== "extensionDataReady" || result()) return
    request()
  })

  // Reset and recheck whenever the selected scope or backend state changes.
  createEffect(() => {
    revision()
    if (!enabled()) {
      requested = ""
      preserve = ""
      setResult(undefined)
      setInstalls([])
      return
    }
    const next = key()
    if (!agent() || !directory() || next === requested) return
    requested = next
    setResult(undefined)
    if (preserve !== next) setInstalls([])
    preserve = ""
    request()
  })

  const checking = createMemo(() => enabled() && result() === undefined)
  const installing = createMemo(() => installs().some((item) => item.status === "installing"))
  // Fail closed while an enabled check is unresolved or unsuccessful.
  const blocked = createMemo(() => {
    if (!enabled()) return false
    const current = result()
    return !current || current.state === "blocked" || current.state === "error"
  })
  const visible = createMemo(() => {
    const current = result()
    return current?.state === "blocked" || current?.state === "error"
  })

  const retry = () => {
    setInstalls([])
    setResult(undefined)
    request(true)
  }

  const installAll = () => {
    if (!enabled() || installing() || !result() || !directory()) return
    vscode.postMessage({
      type: "installAgentRequirements",
      agent: agent(),
      directory: directory(),
      sessionID: session.currentSessionID(),
    })
  }

  onCleanup(() => {
    unsubscribe()
    if (retryTimer) clearTimeout(retryTimer)
  })

  return (
    <AgentRequirementsContext.Provider
      value={{ result, installs, checking, installing, blocked, visible, retry, installAll }}
    >
      {props.children}
    </AgentRequirementsContext.Provider>
  )
}

export function useAgentRequirements(): AgentRequirementsContextValue {
  const value = useContext(AgentRequirementsContext)
  if (!value) throw new Error("useAgentRequirements must be used within an AgentRequirementsProvider")
  return value
}
