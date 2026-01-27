import * as vscode from "vscode"

const DEFAULT_PORT = 4096
const HEALTH_TIMEOUT = 3000

export interface ServerInfo {
  url: string
  version: string
}

export async function discoverServer(): Promise<ServerInfo | null> {
  const ports = [DEFAULT_PORT]

  for (const port of ports) {
    const url = `http://localhost:${port}`
    const info = await checkHealth(url)
    if (info) {
      return info
    }
  }

  return null
}

export async function checkHealth(url: string): Promise<ServerInfo | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT)

  try {
    const response = await fetch(`${url}/global/health`, {
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as { healthy: boolean; version: string }
    if (!data.healthy) {
      return null
    }

    return { url, version: data.version }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export class ServerWatcher implements vscode.Disposable {
  private interval: ReturnType<typeof setInterval> | undefined
  private disposed = false
  private current: ServerInfo | null = null
  private readonly onChangeEmitter = new vscode.EventEmitter<ServerInfo | null>()

  readonly onChange = this.onChangeEmitter.event

  constructor(private readonly pollInterval = 5000) {}

  async start(): Promise<ServerInfo | null> {
    this.current = await discoverServer()
    this.startPolling()
    return this.current
  }

  private startPolling() {
    if (this.disposed) {
      return
    }

    this.interval = setInterval(async () => {
      const info = await discoverServer()
      const changed = info?.url !== this.current?.url || info?.version !== this.current?.version
      if (changed) {
        this.current = info
        this.onChangeEmitter.fire(info)
      }
    }, this.pollInterval)
  }

  get server(): ServerInfo | null {
    return this.current
  }

  dispose() {
    this.disposed = true
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = undefined
    }
    this.onChangeEmitter.dispose()
  }
}
