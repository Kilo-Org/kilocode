/**
 * VS Code API context provider
 * Provides access to the VS Code webview API for posting messages
 */

import { createContext, useContext, onCleanup, ParentComponent, createSignal } from "solid-js"
import type { VSCodeAPI, WebviewMessage, ExtensionMessage } from "../types/messages"
import { ClipboardProvider } from "@kilocode/kilo-ui/context/clipboard"

// Get the VS Code API (only available in webview context)
let vscodeApi: VSCodeAPI | undefined

export function getVSCodeAPI(): VSCodeAPI {
  if (!vscodeApi) {
    // In VS Code webview, acquireVsCodeApi is available globally
    if (typeof acquireVsCodeApi === "function") {
      vscodeApi = acquireVsCodeApi()
    } else {
      // Mock for development/testing outside VS Code
      console.warn("[Kilo New] Running outside VS Code, using mock API")
      vscodeApi = {
        postMessage: (msg) => console.log("[Kilo New] Mock postMessage:", msg),
        getState: () => undefined,
        setState: () => {},
      }
    }
  }
  return vscodeApi
}

// Context value type
interface VSCodeContextValue {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
  getState: <T>() => T | undefined
  setState: <T>(state: T) => void
  getModelSelectorExpanded: () => boolean
  setModelSelectorExpanded: (value: boolean) => void
}

const VSCodeContext = createContext<VSCodeContextValue>()

export const VSCodeProvider: ParentComponent = (props) => {
  const api = getVSCodeAPI()
  const handlers = new Set<(message: ExtensionMessage) => void>()

  // Model-selector expand/collapse preference. Stored in extension globalState
  // so it is shared across webviews (sidebar + agent-manager panel); a local
  // signal mirrors it for synchronous reads.
  const [expanded, setExpanded] = createSignal(true)

  // Listen for messages from the extension
  const messageListener = (event: MessageEvent) => {
    const message = event.data as ExtensionMessage
    handlers.forEach((handler) => handler(message))
  }

  window.addEventListener("message", messageListener)
  handlers.add((message) => {
    if (message?.type === "modelSelectorExpandedLoaded") setExpanded(message.value)
  })
  api.postMessage({ type: "requestModelSelectorExpanded" })

  onCleanup(() => {
    window.removeEventListener("message", messageListener)
    handlers.clear()
  })

  const value: VSCodeContextValue = {
    postMessage: (message: WebviewMessage) => {
      api.postMessage(message)
    },
    onMessage: (handler: (message: ExtensionMessage) => void) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    getState: <T,>() => api.getState() as T | undefined,
    setState: <T,>(state: T) => api.setState(state),
    getModelSelectorExpanded: expanded,
    setModelSelectorExpanded: (value: boolean) => {
      setExpanded(value)
      api.postMessage({ type: "persistModelSelectorExpanded", value })
    },
  }

  return (
    <VSCodeContext.Provider value={value}>
      <ClipboardProvider write={(text) => api.postMessage({ type: "agentManager.copyToClipboard", text })}>
        {props.children}
      </ClipboardProvider>
    </VSCodeContext.Provider>
  )
}

export function useVSCode(): VSCodeContextValue {
  const context = useContext(VSCodeContext)
  if (!context) {
    throw new Error("useVSCode must be used within a VSCodeProvider")
  }
  return context
}
