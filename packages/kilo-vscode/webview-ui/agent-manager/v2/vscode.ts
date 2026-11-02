// The VS Code bridge of the Agent Manager webview: the shared context, typed with the Agent Manager messages in
// addition to the relay and the standard webview messages.
import { useVSCode as useShared } from "../../src/context/vscode"
import type {
  AgentManagerExtensionMessage,
  AgentManagerWebviewMessage,
} from "../../src/types/messages/agent-manager"
import type { ToHost, ToWebview } from "../../../src/protocol"

export type OutMessage = AgentManagerWebviewMessage | ToHost
export type InMessage = AgentManagerExtensionMessage | ToWebview

export function useVSCode() {
  const shared = useShared()
  return {
    ...shared,
    // The shared context types its messages with the host protocol of the sidebar; the panel host also accepts the
    // Agent Manager messages, so both unions travel over the same channel.
    postMessage: (message: OutMessage) => shared.postMessage(message as ToHost),
    onMessage: (handler: (message: InMessage) => void) =>
      shared.onMessage((message) => handler(message as InMessage)),
  }
}

export type VSCodeContext = ReturnType<typeof useVSCode>
