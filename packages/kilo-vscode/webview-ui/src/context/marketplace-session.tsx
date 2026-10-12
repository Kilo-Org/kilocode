import { createContext, createSignal, onCleanup, useContext, type ParentComponent } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage, McpAuthStatus, SessionStatusInfo } from "../types/messages"

interface MarketplaceSessionContextValue {
  allStatusMap: () => Record<string, SessionStatusInfo>
  mcpAuth: () => { needsAuth: string[]; busy: string[] }
  mcpAuthResult: () => { name: string; status: McpAuthStatus; error?: string } | undefined
  resetMcpAuthResult: () => void
  signInMcp: (name: string, notify?: boolean) => void
  cancelMcpSignIn: (name: string) => void
}

const MarketplaceSessionContext = createContext<MarketplaceSessionContextValue>()

/**
 * Tracks backend session statuses and MCP OAuth sign-in state without
 * loading the full chat SessionProvider, enabling Marketplace busy-session
 * warnings and the post-install sign-in step in InstallModal.
 */
export const MarketplaceSessionProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [statuses, setStatuses] = createSignal<Record<string, SessionStatusInfo>>({})
  const [mcpAuthState, setMcpAuthState] = createSignal<{ needsAuth: string[]; busy: string[] }>({
    needsAuth: [],
    busy: [],
  })
  const [mcpAuthResult, setMcpAuthResult] = createSignal<
    { name: string; status: McpAuthStatus; error?: string } | undefined
  >(undefined)

  const unsubscribe = vscode.onMessage((msg: ExtensionMessage) => {
    if (msg.type === "sessionStatus") {
      const status: SessionStatusInfo =
        msg.status === "retry"
          ? { type: "retry", attempt: msg.attempt!, message: msg.message!, next: msg.next! }
          : msg.status === "offline"
            ? { type: "offline", message: msg.message! }
            : { type: msg.status }
      setStatuses((current) => ({ ...current, [msg.sessionID]: status }))
      return
    }
    if (msg.type === "mcpAuthState") {
      setMcpAuthState({ needsAuth: msg.needsAuth, busy: msg.busy })
      return
    }
    if (msg.type === "mcpAuthResult") {
      setMcpAuthResult({ name: msg.name, status: msg.status, error: msg.error })
    }
  })
  onCleanup(unsubscribe)

  vscode.postMessage({ type: "requestMcpAuthState" })

  const signInMcp = (name: string, notify?: boolean) => {
    vscode.postMessage({ type: "signInMcp", name, notify })
  }

  const resetMcpAuthResult = () => setMcpAuthResult(undefined)

  const cancelMcpSignIn = (name: string) => {
    vscode.postMessage({ type: "cancelMcpSignIn", name })
  }

  return (
    <MarketplaceSessionContext.Provider
      value={{
        allStatusMap: statuses,
        mcpAuth: mcpAuthState,
        mcpAuthResult,
        resetMcpAuthResult,
        signInMcp,
        cancelMcpSignIn,
      }}
    >
      {props.children}
    </MarketplaceSessionContext.Provider>
  )
}

export function useMarketplaceSession(): MarketplaceSessionContextValue {
  const context = useContext(MarketplaceSessionContext)
  if (!context) throw new Error("useMarketplaceSession must be used within MarketplaceSessionProvider")
  return context
}
