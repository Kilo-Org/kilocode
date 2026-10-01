import { createSignal } from "solid-js"
import type { ExtensionMessage, McpAuthStatus, McpBundle, McpStatusEntry } from "../types/messages"

interface Deps {
  post: (message: unknown) => void
  connected: () => boolean
}

/**
 * MCP runtime status and OAuth sign-in state for the session context. The
 * extension host (its `fetchAndSendMcpStatus` and `McpAuthService`) is the
 * source of truth; this mirrors its pushes and forwards user intent.
 * Extracted from session.tsx to keep that file within its max-lines budget.
 */
export function createMcpAuth(deps: Deps) {
  const [status, setStatus] = createSignal<Record<string, McpStatusEntry>>({})
  const [loading, setLoading] = createSignal<string | null>(null)
  const [state, setState] = createSignal<{ needsAuth: string[]; busy: string[] }>({ needsAuth: [], busy: [] })
  const [result, setResult] = createSignal<{ name: string; status: McpAuthStatus; error?: string } | undefined>(
    undefined,
  )
  const [bundles, setBundles] = createSignal<McpBundle[]>([])

  // Connect/disconnect share one in-flight slot, so the UI can disable the
  // whole row while the backend reconciles. Sign-in tracks busy per server
  // instead, since it can block on a browser round-trip for minutes.
  const toggle = (type: "connectMcp" | "disconnectMcp", name: string) => {
    if (loading()) return
    if (!deps.connected()) return
    setLoading(name)
    deps.post({ type, name })
  }

  return {
    status,
    loading,
    state,
    result,
    bundles,
    connect: (name: string) => toggle("connectMcp", name),
    disconnect: (name: string) => toggle("disconnectMcp", name),
    remove: (name: string) => deps.post({ type: "removeMcp", name }),
    signIn: (name: string, notify?: boolean) => {
      if (!deps.connected()) return
      deps.post({ type: "signInMcp", name, notify })
    },
    cancel: (name: string) => deps.post({ type: "cancelMcpSignIn", name }),
    reset: (name: string) => deps.post({ type: "resetMcpAuth", name }),
    refreshBundles: () => deps.post({ type: "requestMcpBundles" }),
    requestStatus: () => deps.post({ type: "requestMcpStatus" }),
    request: () => deps.post({ type: "requestMcpAuthState" }),
    /** Returns true when the message was an MCP message and was consumed. */
    accept: (message: ExtensionMessage): boolean => {
      if (message.type === "mcpStatusLoaded") {
        setStatus(message.status)
        setLoading(null)
        return true
      }
      if (message.type === "mcpAuthState") {
        setState({ needsAuth: message.needsAuth, busy: message.busy })
        return true
      }
      if (message.type === "mcpAuthResult") {
        setResult({ name: message.name, status: message.status, error: message.error })
        return true
      }
      if (message.type === "mcpBundles") {
        setBundles(message.bundles)
        return true
      }
      return false
    },
  }
}
