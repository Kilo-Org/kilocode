export interface ServerInfo {
  url: string
  version: string
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

export interface ExtensionMessage {
  type: "server" | "workspace" | "settings"
  server?: ServerInfo | null
  directory?: string | null
  model?: ModelSelection | null
}

export interface WebviewMessage {
  type: "ready" | "log" | "save-settings"
  message?: string
  model?: ModelSelection | null
}

declare global {
  function acquireVsCodeApi<T>(): {
    postMessage(message: WebviewMessage): void
    getState(): T | undefined
    setState(state: T): T
  }
}
