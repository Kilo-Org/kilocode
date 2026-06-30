/** @jsxImportSource solid-js */

import { createContext, createEffect, createMemo, createSignal, onCleanup, useContext } from "solid-js"
import type { Accessor, ParentComponent } from "solid-js"
import { useConfig } from "./config"
import { useServer } from "./server"
import { useSession } from "./session"
import { useVSCode } from "./vscode"
import type { AgentRequirementResult } from "../types/messages"
import { keepAgentRequirementsResult } from "./agent-requirements-state"

export interface AgentRequirementsContextValue {
  result: Accessor<AgentRequirementResult | undefined>
  checking: Accessor<boolean>
  blocked: Accessor<boolean>
  visible: Accessor<boolean>
}

export const AgentRequirementsContext = createContext<AgentRequirementsContextValue>()

export const AgentRequirementsProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const session = useSession()
  const server = useServer()
  const config = useConfig()
  const [result, setResult] = createSignal<AgentRequirementResult>()
  const [revision, setRevision] = createSignal(0)
  const [pending, setPending] = createSignal(false)
  const [requested, setRequested] = createSignal("")

  const enabled = () => config.config().experimental?.agent_requirements === true
  const agent = () => session.selectedAgent()
  const directory = () => server.workspaceDirectory()
  const key = () => `${directory()}\0${agent()}`
  const active = (value: { agent: string; directory: string }) =>
    value.agent === agent() && value.directory === directory()

  const request = () => {
    if (!enabled() || !agent() || !directory()) return
    setPending(true)
    vscode.postMessage({
      type: "requestAgentRequirements",
      agent: agent(),
      directory: directory(),
      sessionID: session.currentSessionID(),
    })
  }

  const unsubscribe = vscode.onMessage((message) => {
    if (message.type === "agentRequirementsLoaded") {
      if (!active(message.result)) return
      setPending(false)
      setResult(message.result)
      return
    }

    if (message.type === "agentRequirementsInvalidated") {
      setRequested("")
      setRevision((value) => value + 1)
    }
  })

  createEffect(() => {
    revision()
    if (!enabled()) {
      setRequested("")
      setPending(false)
      setResult(undefined)
      return
    }

    const next = key()
    if (!agent() || !directory() || next === requested()) return
    setRequested(next)
    setPending(true)
    if (!keepAgentRequirementsResult(result(), agent(), directory())) setResult(undefined)
    request()
  })

  const checking = createMemo(() => enabled() && pending())
  const blocked = createMemo(() => {
    if (!enabled()) return false
    const current = result()
    return !current || current.state === "blocked" || current.state === "error"
  })
  const visible = createMemo(() => {
    const current = result()
    return current?.state === "blocked" || current?.state === "error"
  })

  onCleanup(unsubscribe)

  return (
    <AgentRequirementsContext.Provider value={{ result, checking, blocked, visible }}>
      {props.children}
    </AgentRequirementsContext.Provider>
  )
}

export function useAgentRequirements(): AgentRequirementsContextValue {
  const value = useContext(AgentRequirementsContext)
  if (!value) throw new Error("useAgentRequirements must be used within an AgentRequirementsProvider")
  return value
}
