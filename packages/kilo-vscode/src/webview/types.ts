export interface ServerInfo {
  url: string
  version: string
}

export interface ExtensionMessage {
  type: "server" | "workspace"
  server?: ServerInfo | null
  directory?: string | null
}

export interface WebviewMessage {
  type: "ready" | "log"
  message?: string
}

declare global {
  function acquireVsCodeApi<T>(): {
    postMessage(message: WebviewMessage): void
    getState(): T | undefined
    setState(state: T): T
  }
}
