import * as vscode from "vscode"
import { type KiloConnectionService, type McpStatus } from "../cli-backend"

export type BrowserAutomationState = "disabled" | "registering" | "connected" | "failed" | "disconnected"

export class BrowserAutomationService implements vscode.Disposable {
  private state: BrowserAutomationState = "disabled"
  private disposables: vscode.Disposable[] = []
  private stateListeners: Array<(state: BrowserAutomationState) => void> = []

  // MCP server name used when registering with the CLI backend
  private static readonly MCP_SERVER_NAME = "kilo-playwright"

  constructor(private readonly connectionService: KiloConnectionService) {
    // Listen for settings changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("kilo-code.new.browserAutomation")) {
          this.syncWithSettings()
        }
      }),
    )
  }

  /** Current state */
  getState(): BrowserAutomationState {
    return this.state
  }

  /** Subscribe to state changes */
  onStateChange(listener: (state: BrowserAutomationState) => void): () => void {
    this.stateListeners.push(listener)
    return () => {
      const idx = this.stateListeners.indexOf(listener)
      if (idx >= 0) {
        this.stateListeners.splice(idx, 1)
      }
    }
  }

  /**
   * Read settings and enable/disable accordingly.
   * Called on construction and when settings change.
   */
  async syncWithSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration("kilo-code.new.browserAutomation")
    const enabled = config.get<boolean>("enabled", false)

    if (enabled) {
      await this.register()
    } else {
      await this.unregister()
    }
  }

  /**
   * Re-register the MCP server after CLI backend reconnects.
   * Should be called from the connection state change handler.
   */
  async reregisterIfEnabled(): Promise<void> {
    const config = vscode.workspace.getConfiguration("kilo-code.new.browserAutomation")
    const enabled = config.get<boolean>("enabled", false)
    if (enabled) {
      await this.register()
    }
  }

  /**
   * Register the Playwright MCP server with the CLI backend.
   */
  private async register(): Promise<void> {
    this.setState("registering")

    const httpClient = this.getHttpClient()
    if (!httpClient) {
      console.error("[Kilo New] BrowserAutomationService: No HTTP client available")
      this.setState("failed")
      return
    }

    const config = vscode.workspace.getConfiguration("kilo-code.new.browserAutomation")
    const useSystemChrome = config.get<boolean>("useSystemChrome", true)
    const headless = config.get<boolean>("headless", false)

    // Build the command for the Playwright MCP server
    const command = ["npx", "@playwright/mcp@latest"]
    if (headless) {
      command.push("--headless")
    }
    if (useSystemChrome) {
      command.push("--browser", "chrome")
    }

    try {
      const directory = this.getWorkspaceDirectory()
      const status = await httpClient.addMcpServer(
        BrowserAutomationService.MCP_SERVER_NAME,
        {
          type: "local",
          command,
          enabled: true,
          timeout: 60000,
        },
        directory,
      )

      const serverStatus = status[BrowserAutomationService.MCP_SERVER_NAME]
      if (serverStatus?.status === "connected") {
        this.setState("connected")
      } else if (serverStatus?.status === "failed") {
        console.error(
          "[Kilo New] BrowserAutomationService: MCP server failed:",
          (serverStatus as { error?: string }).error,
        )
        this.setState("failed")
      } else {
        this.setState("disconnected")
      }
    } catch (error) {
      console.error("[Kilo New] BrowserAutomationService: Failed to register MCP server:", error)
      this.setState("failed")
    }
  }

  /**
   * Unregister/disconnect the Playwright MCP server.
   */
  private async unregister(): Promise<void> {
    if (this.state === "disabled") {
      return
    }

    const httpClient = this.getHttpClient()
    if (httpClient) {
      try {
        const directory = this.getWorkspaceDirectory()
        await httpClient.disconnectMcpServer(BrowserAutomationService.MCP_SERVER_NAME, directory)
      } catch (error) {
        console.error("[Kilo New] BrowserAutomationService: Failed to disconnect MCP server:", error)
      }
    }

    this.setState("disabled")
  }

  /**
   * Get the current MCP server status from the CLI backend.
   */
  async getServerStatus(): Promise<McpStatus | null> {
    const httpClient = this.getHttpClient()
    if (!httpClient) {
      return null
    }

    try {
      const directory = this.getWorkspaceDirectory()
      const allStatus = await httpClient.getMcpStatus(directory)
      return allStatus[BrowserAutomationService.MCP_SERVER_NAME] ?? null
    } catch {
      return null
    }
  }

  private getHttpClient() {
    try {
      return this.connectionService.getHttpClient()
    } catch {
      return null
    }
  }

  private getWorkspaceDirectory(): string {
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath
    }
    return process.cwd()
  }

  private setState(state: BrowserAutomationState): void {
    if (this.state === state) {
      return
    }
    console.log(`[Kilo New] BrowserAutomationService: State ${this.state} → ${state}`)
    this.state = state
    for (const listener of this.stateListeners) {
      listener(state)
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []
    this.stateListeners = []
  }
}
