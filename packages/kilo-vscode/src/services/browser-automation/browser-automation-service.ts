import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../cli-backend"
import { playwrightCommand } from "./settings"

type BrowserAutomationState = "disabled" | "registering" | "connected" | "failed" | "disconnected"

/**
 * Manages the built-in Playwright MCP browser server for ordinary Kilo sessions.
 *
 * This is independent from the Agent Manager browser broker. It must not read
 * Agent Manager settings, and Agent Manager must not read its settings.
 */
export class BrowserAutomationService implements vscode.Disposable {
  // MCP server name used when registering with the CLI backend
  private static readonly MCP_SERVER_NAME = "kilo-playwright"
  private readonly disposables: vscode.Disposable[] = []
  private readonly registered = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private disposed = false
  private state: BrowserAutomationState = "disabled"

  constructor(private readonly connectionService: KiloConnectionService) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("kilo-code.new.browserAutomation")) return
        void this.syncWithSettings()
      }),
    )
  }

  /**
   * Read the Playwright settings and enable or disable the MCP server.
   * Called on construction and when Playwright settings change.
   */
  syncWithSettings(): Promise<void> {
    return this.enqueue(() => this.apply())
  }

  /**
   * Re-register the MCP server after the CLI backend reconnects.
   */
  reregisterIfEnabled(): Promise<void> {
    return this.enqueue(() => this.apply())
  }

  /**
   * Run one settings transition at a time. Each transition reads the current
   * settings when it runs, so a queued change cannot restore stale state.
   */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(task, task)
    this.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private async apply(): Promise<void> {
    if (this.disposed) return
    if (!this.enabled()) {
      await this.unregister()
      return
    }
    if (!vscode.workspace.isTrusted) {
      console.warn("[Kilo New] BrowserAutomationService: Workspace is not trusted, skipping Playwright MCP")
      this.setState("disabled")
      return
    }
    await this.register()
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration("kilo-code.new.browserAutomation").get<boolean>("enabled", false) === true
  }

  private command(): string[] {
    const config = vscode.workspace.getConfiguration("kilo-code.new.browserAutomation")
    return playwrightCommand({
      headless: config.get<boolean>("headless", false),
      useSystemChrome: config.get<boolean>("useSystemChrome", true),
    })
  }

  private directories(): string[] {
    const folders = vscode.workspace.workspaceFolders ?? []
    const dirs = folders.length > 0 ? folders.map((folder) => folder.uri.fsPath) : [process.cwd()]
    return [...new Set(dirs)]
  }

  private async register(): Promise<void> {
    const client = this.getClient()
    if (!client) {
      this.setState("failed")
      return
    }
    const command = this.command()
    this.setState("registering")
    let failure: unknown
    for (const directory of this.directories()) {
      try {
        const { data: status } = await client.mcp.add(
          {
            name: BrowserAutomationService.MCP_SERVER_NAME,
            config: {
              type: "local",
              command,
              enabled: true,
              timeout: 60000,
            },
            directory,
          },
          { throwOnError: true },
        )
        const server = status[BrowserAutomationService.MCP_SERVER_NAME]
        if (server?.status === "connected") {
          this.registered.add(directory)
          continue
        }
        this.registered.delete(directory)
        if (server?.status === "failed") {
          const detail = (server as { error?: string }).error
          failure = new Error(`Playwright MCP failed to start${detail ? `: ${detail}` : ""}`)
        }
      } catch (error) {
        this.registered.delete(directory)
        failure = error
      }
    }
    if (this.registered.size > 0) {
      this.setState("connected")
      return
    }
    if (failure) {
      console.error("[Kilo New] BrowserAutomationService: Failed to register MCP server:", failure)
      this.setState("failed")
      return
    }
    this.setState("disconnected")
  }

  private async unregister(): Promise<void> {
    const client = this.getClient()
    if (client) {
      for (const directory of [...this.registered]) {
        try {
          await client.mcp.disconnect(
            { name: BrowserAutomationService.MCP_SERVER_NAME, directory },
            { throwOnError: true },
          )
          this.registered.delete(directory)
        } catch (error) {
          console.error("[Kilo New] BrowserAutomationService: Failed to disconnect MCP server:", error)
        }
      }
    }
    this.setState("disabled")
  }

  private getClient(): KiloClient | null {
    try {
      return this.connectionService.getClient()
    } catch {
      return null
    }
  }

  private setState(state: BrowserAutomationState): void {
    if (this.state === state) return
    console.log(`[Kilo New] BrowserAutomationService: State ${this.state} -> ${state}`)
    this.state = state
  }

  dispose(): void {
    this.disposed = true
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }
}
