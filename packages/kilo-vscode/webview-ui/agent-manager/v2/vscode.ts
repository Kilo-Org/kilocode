// The VS Code bridge of the Agent Manager webview: the shared context, typed with the Agent Manager messages in
// addition to the relay and the standard webview messages.
import { useVSCode } from "../../src/context/vscode"
import type { ToHost } from "../../../src/protocol"
import type { InMessage, OutMessage, SharedContext, VSCodeContext } from "./bridge"

export type { InMessage, OutMessage, SharedContext, VSCodeContext } from "./bridge"

export function useBridge(): VSCodeContext & { shared: SharedContext } {
  const shared = useVSCode()
  return {
    ...shared,
    // The shared context types its messages with the host protocol of the sidebar; the panel host also accepts the
    // Agent Manager messages, so both unions travel over the same channel.
    postMessage: (message: OutMessage) => shared.postMessage(message as ToHost),
    onMessage: (handler: (message: InMessage) => void) => shared.onMessage((message) => handler(message as InMessage)),
    /** The shared context, for hooks typed with the sidebar messages (voice input). */
    shared,
  }
}
