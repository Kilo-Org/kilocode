import { createContext, createSignal, onCleanup, useContext, type ParentComponent } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage, SessionStatusInfo } from "../types/messages"

interface MarketplaceSessionContextValue {
  allStatusMap: () => Record<string, SessionStatusInfo>
}

const MarketplaceSessionContext = createContext<MarketplaceSessionContextValue>()

/**
 * Tracks backend session statuses without loading the full chat SessionProvider,
 * enabling Marketplace busy-session warnings.
 */
export const MarketplaceSessionProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [statuses, setStatuses] = createSignal<Record<string, SessionStatusInfo>>({})
  const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
    if (msg.type !== "sessionStatus") return
    const status: SessionStatusInfo =
      msg.status === "retry"
        ? { type: "retry", attempt: msg.attempt!, message: msg.message!, next: msg.next! }
        : msg.status === "offline"
          ? { type: "offline", message: msg.message! }
          : { type: msg.status }
    setStatuses((current) => ({ ...current, [msg.sessionID]: status }))
  })
  onCleanup(unsubscribe)

  return (
    <MarketplaceSessionContext.Provider value={{ allStatusMap: statuses }}>
      {props.children}
    </MarketplaceSessionContext.Provider>
  )
}

export function useMarketplaceSession(): MarketplaceSessionContextValue {
  const context = useContext(MarketplaceSessionContext)
  if (!context) throw new Error("useMarketplaceSession must be used within MarketplaceSessionProvider")
  return context
}
