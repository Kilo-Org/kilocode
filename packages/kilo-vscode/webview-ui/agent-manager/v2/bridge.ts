// The Agent Manager webview bridge types. Kept free of JSX and contexts, so modules the extension tests load can type
// against them.
import type { AgentManagerExtensionMessage, AgentManagerWebviewMessage } from "../../src/types/messages/agent-manager"
import type { ToHost, ToWebview } from "../../../src/protocol"

export type OutMessage = AgentManagerWebviewMessage | ToHost
export type InMessage = AgentManagerExtensionMessage | ToWebview

export type VSCodeContext = {
  postMessage: (message: OutMessage) => void
  onMessage: (handler: (message: InMessage) => void) => () => void
  getState: <T>() => T | undefined
  setState: <T>(state: T) => void
  sidebarSide: () => "left" | "right" | undefined
  active: () => boolean
  getModelSelectorExpanded: () => boolean
  setModelSelectorExpanded: (value: boolean) => void
}
