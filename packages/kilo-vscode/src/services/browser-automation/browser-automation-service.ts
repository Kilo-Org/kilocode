import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../cli-backend"
import { playwrightCommand } from "./settings"
import { canonicalizePath, samePath } from "../../agent-manager/project/paths"

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

  constructor(
    private readonly connectionService: KiloConnectionService,
    private readonly wait = 15_000,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("kilo-code.new.browserAutomation")) return
        void this.syncWithSettings()
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.enqueue(() => this.apply(true))),
      {
        dispose: connectionService.onEvent((event) => {
          if (event.type !== "server.instance.disposed") return
          return this.enqueue(async () => {
            if (this.disposed) return
            const root = canonicalizePath(event.properties.directory)
            const dirs = [...new Set([...this.registered, ...this.directories()])].filter((dir) =>
              samePath(canonicalizePath(dir), root),
            )
            if (!dirs.length) return
            // Config saves and Reload discard MCP state without reconnecting SSE.
            for (const dir of dirs) this.registered.delete(dir)
            await this.apply(true)
          })
        }),
      },
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

  ready(directory: string): Promise<void> {
    const task = this.enqueue(async () => {
      if (this.disposed || !this.enabled() || !vscode.workspace.isTrusted) return
      const dir = this.directories().find((dir) => samePath(canonicalizePath(dir), canonicalizePath(directory)))
      if (!dir) return
      const client = this.getClient()
      if (!client) throw new Error("Playwright browser automation is waiting for the CLI connection.")
      // A prompt can arrive before the disposal event or before MCP startup finishes.
      const { data: status } = await client.mcp.status({ directory: dir }, { throwOnError: true })
      const server = status[BrowserAutomationService.MCP_SERVER_NAME]
      if (server?.status === "connected") return
      // A failed server stays failed until settings change, reconnect, or
      // disposal. Do not spawn another npx attempt on every prompt.
      if (server?.status === "failed") throw BrowserAutomationService.failure((server as { error?: string }).error)
      this.registered.delete(dir)
      if (!this.enabled()) return
      await this.register([dir])
      if (this.enabled() && !this.registered.has(dir)) throw BrowserAutomationService.failure()
    })
    return BrowserAutomationService.bounded(task, this.wait)
  }

  /**
   * Cap how long a prompt waits for Playwright MCP. A cold `npx` start can hold
   * the shared queue for up to the MCP timeout, and a prompt should not stall
   * that long; its tools arrive on a later turn instead.
   */
  private static async bounded(task: Promise<void>, wait: number): Promise<void> {
    const limit = Promise.withResolvers<"timeout">()
    const timer = setTimeout(() => limit.resolve("timeout"), wait)
    const outcome = task.then(
      () => undefined,
      (error) => {
        console.warn("[Kilo New] BrowserAutomationService: readiness failed:", error)
        return { error }
      },
    )
    void outcome.then(() => clearTimeout(timer))
    const result = await Promise.race([outcome, limit.promise])
    if (result === "timeout") {
      console.warn(
        "[Kilo New] BrowserAutomationService: readiness timed out, submitting without waiting for Playwright MCP",
      )
      return
    }
    if (result) throw result.error
  }

  private static failure(detail?: string): Error {
    return new Error(
      `Playwright browser automation could not connect${detail ? ` (${detail})` : ""}. Check the Extension Host output, or disable Browser Automation in Web Tools to continue without it.`,
    )
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

  private async apply(reconcile = false): Promise<void> {
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
    const dirs = this.directories()
    const removed = [...this.registered].filter((dir) => !dirs.includes(dir))
    if (removed.length) await this.unregister(removed)
    await this.register(reconcile ? dirs.filter((dir) => !this.registered.has(dir)) : dirs)
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

  private async register(dirs: string[]): Promise<void> {
    const client = this.getClient()
    if (!client) {
      this.setState("failed")
      return
    }
    const command = this.command()
    this.setState("registering")
    let failure: unknown
    for (const directory of dirs) {
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

  private async unregister(dirs = [...this.registered]): Promise<void> {
    const client = this.getClient()
    if (client) {
      for (const directory of dirs) {
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
