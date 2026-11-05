import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { workspace, type Disposable } from "vscode"
import { local } from "../../local"
import { canonicalizePath, samePath } from "../../agent-manager/project/paths"
import type { Manager } from "../../server"
import { playwrightCommand } from "./settings"

/**
 * Manages the built-in Playwright MCP browser server for ordinary Kilo sessions.
 *
 * This is independent from the Agent Manager browser broker. It must not read
 * Agent Manager settings, and Agent Manager must not read its settings.
 *
 * The v2 server serves MCP registration at runtime (`/api/experimental/mcp`), so the server itself provides a
 * fresh client per start and this service only reconciles the registered set with the current settings, server
 * start, and workspace folders.
 */
export class BrowserAutomationService implements Disposable {
  private static readonly MCP_SERVER_NAME = "kilo-playwright"
  private readonly listener: Disposable
  private readonly folders: Disposable
  private readonly registered = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly input: { server: Manager; log?: (...args: unknown[]) => void },
  ) {
    this.listener = workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("kilo-code.v2.browserAutomation")) return
      void this.syncWithSettings()
    })
    this.folders = workspace.onDidChangeWorkspaceFolders(() => void this.syncWithSettings())
  }

  /** Read the Playwright settings and enable or disable the MCP server. */
  syncWithSettings(): Promise<void> {
    return this.enqueue(() => this.apply())
  }

  /** Re-register the MCP server after the v2 server (re)starts, which drops runtime MCP state. */
  started(): Promise<void> {
    return this.enqueue(async () => {
      this.cached = undefined
      this.registered.clear()
      await this.apply()
    })
  }

  stopped(): void {
    this.cached = undefined
    this.registered.clear()
  }

  private cached: { url: string; client: OpenCodeClient } | undefined

  private async client(): Promise<OpenCodeClient> {
    const server = await this.input.server.get()
    if (this.cached?.url === server.url) return this.cached.client
    const client = OpenCode.make({
      baseUrl: server.url,
      headers: { authorization: server.authorization },
      fetch: local,
    })
    this.cached = { url: server.url, client }
    return client
  }

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
    if (!workspace.isTrusted) {
      this.log("Workspace is not trusted, skipping Playwright MCP")
      return
    }
    const dirs = this.directories()
    const removed = [...this.registered].filter((dir) => !dirs.some((current) => samePath(dir, current)))
    if (removed.length) await this.unregister(removed)
    await this.register(dirs.filter((dir) => !this.registered.has(dir)))
  }

  private enabled(): boolean {
    return workspace.getConfiguration("kilo-code.v2.browserAutomation").get<boolean>("enabled", false) === true
  }

  private command(): string[] {
    const config = workspace.getConfiguration("kilo-code.v2.browserAutomation")
    return playwrightCommand({
      headless: config.get<boolean>("headless", false),
      useSystemChrome: config.get<boolean>("useSystemChrome", true),
    })
  }

  private directories(): string[] {
    const folders = workspace.workspaceFolders ?? []
    const dirs = folders.length > 0 ? folders.map((folder) => canonicalizePath(folder.uri.fsPath)) : [process.cwd()]
    return [...new Set(dirs)]
  }

  private async register(dirs: string[]): Promise<void> {
    if (dirs.length === 0) return
    const client = await this.client()
    const command = this.command()
    let failure: unknown
    for (const directory of dirs) {
      try {
        await client.experimental.mcp.add({
          server: BrowserAutomationService.MCP_SERVER_NAME,
          location: { directory },
          config: {
            type: "local",
            command,
            codemode: false,
            timeout: { startup: 60_000 },
          },
        })
        const { data } = await client.mcp.list({ location: { directory } })
        const server = data.find((item) => item.name === BrowserAutomationService.MCP_SERVER_NAME)
        if (server?.status.status === "connected") {
          this.registered.add(directory)
          continue
        }
        if (server?.status.status === "failed")
          failure = new Error(`Playwright MCP failed to start: ${server.status.error}`)
      } catch (error) {
        failure = error
      }
    }
    if (this.registered.size > 0) return
    if (failure) this.log("Failed to register MCP server:", failure)
  }

  private async unregister(dirs = [...this.registered]): Promise<void> {
    if (dirs.length > 0) {
      const client = await this.client()
      for (const directory of dirs) {
        try {
          await client.experimental.mcp.remove({
            server: BrowserAutomationService.MCP_SERVER_NAME,
            location: { directory },
          })
        } catch (error) {
          this.log("Failed to remove MCP server:", error)
        }
      }
    }
    for (const directory of dirs) this.registered.delete(directory)
  }

  private log(...args: unknown[]): void {
    this.input.log?.(...args)
  }

  dispose(): void {
    this.disposed = true
    this.listener.dispose()
    this.folders.dispose()
  }
}