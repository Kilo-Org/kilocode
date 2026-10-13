import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../cli-backend"
import { playwrightCommand, playwrightRequest, type PlaywrightBrowser, type PlaywrightProfile } from "./settings"
import { automationBrowsers } from "./chrome-setting"
import { installer, type BrowserStatus } from "./browser-install"
import { canonicalizePath, samePath } from "../../agent-manager/project/paths"
import { isRunningStatus } from "../../session-status"

/** The active Playwright profile, as reported to the agent. It has no browser until an agent picks one. */
interface Selection extends Partial<PlaywrightProfile> {
  allowed: PlaywrightBrowser[]
  changed: boolean
}

/**
 * Manages the built-in Playwright MCP browser server for ordinary Kilo sessions.
 *
 * This is independent from the Agent Manager browser broker. It must not read
 * Agent Manager settings, and Agent Manager must not read its settings.
 *
 * No server runs until an agent picks a browser, device, viewport, and window
 * mode through the browser_profile tool, so the Playwright tools only take
 * context once a session needs them. One server and one browser exist per
 * workspace folder, so a change restarts the browser for every session in that
 * folder. The session that uses or changes the browser owns it until its turn
 * ends, and other sessions cannot change the profile meanwhile.
 */
export class BrowserAutomationService implements vscode.Disposable {
  // MCP server name used when registering with the CLI backend
  private static readonly MCP_SERVER_NAME = "kilo-playwright"
  private readonly disposables: vscode.Disposable[] = []
  private readonly registered = new Set<string>()
  private readonly profiles = new Map<string, PlaywrightProfile>()
  private readonly owners = new Map<string, string>()
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly connectionService: KiloConnectionService,
    private readonly wait = 15_000,
    private readonly check: (browser: PlaywrightBrowser) => Promise<BrowserStatus> = (browser) =>
      installer.check(browser),
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("kilo-code.new.browserAutomation")) return
        void this.syncWithSettings()
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.enqueue(() => this.apply(true))),
      {
        dispose: connectionService.onEvent((event, directory) => {
          if (event.type === "session.status") {
            if (!isRunningStatus(event.properties.status.type)) this.release(event.properties.sessionID)
            return
          }
          if (event.type === "message.part.updated") {
            const part = event.properties.part
            if (part.type === "tool" && part.tool.startsWith(`${BrowserAutomationService.MCP_SERVER_NAME}_`))
              this.claim(part.sessionID, directory)
            return
          }
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
    return this.enqueue(() => {
      // The allowed browsers may have changed, so every browser stops until an agent picks a profile again.
      this.profiles.clear()
      this.owners.clear()
      // The first lookup of a missing Playwright build is slow, so start it before an agent needs it.
      if (!this.disposed && this.enabled()) {
        for (const browser of automationBrowsers()) void this.check(browser).catch(() => undefined)
      }
      return this.apply()
    })
  }

  /**
   * Re-register the MCP server after the CLI backend reconnects.
   */
  reregisterIfEnabled(): Promise<void> {
    return this.enqueue(() => {
      // Turns that owned a browser ended with the previous backend.
      this.owners.clear()
      return this.apply()
    })
  }

  /** Handle agent requests that arrive through the local browser bridge. */
  handle(path: string, body: Record<string, unknown>): Promise<unknown> | undefined {
    if (path === "/playwright/status") {
      const dir = typeof body.directory === "string" ? this.match(body.directory) : undefined
      return Promise.resolve({ enabled: !this.disposed && this.enabled() && vscode.workspace.isTrusted && !!dir })
    }
    if (path === "/playwright/profile") return this.enqueue(() => this.select(body))
    return undefined
  }

  private async select(body: Record<string, unknown>): Promise<Selection> {
    const session = body.sessionID
    if (typeof session !== "string" || typeof body.directory !== "string") {
      throw new Error("sessionID and directory are required")
    }
    if (this.disposed || !this.enabled() || !vscode.workspace.isTrusted) {
      throw new Error("Browser Automation is disabled. The user can enable it in Kilo Settings > Web Tools.")
    }
    const dir = this.match(body.directory)
    if (!dir) throw new Error("Browser Automation is not available in this session's directory.")
    const allowed = automationBrowsers()
    const current = this.profiles.get(dir)
    const next = playwrightRequest(body, current, allowed)
    if (!next) return { ...current, allowed, changed: false }
    const owner = this.owners.get(dir)
    if (owner && owner !== session) {
      throw new Error(
        "Another chat session is using the browser in this folder. Wait until it finishes, then try again. Do not retry in a loop.",
      )
    }
    if (this.registered.has(dir) && BrowserAutomationService.same(current, next)) {
      this.owners.set(dir, session)
      return { ...next, allowed, changed: false }
    }
    if ((await this.check(next.browser)) === "missing") {
      // Chrome and Edge come from their vendors. A Playwright build downloads when the user allows it.
      const fix =
        next.browser === "chrome" || next.browser === "msedge"
          ? "The user has to install it on this machine."
          : "The user can download it in Kilo Settings > Web Tools by turning it off and on under Allowed Browsers."
      throw new Error(`${next.browser} is not installed. ${fix} Use another allowed browser meanwhile.`)
    }
    this.owners.set(dir, session)
    await this.restart(dir, next)
    return { ...next, allowed, changed: true }
  }

  private async restart(dir: string, next: PlaywrightProfile): Promise<void> {
    const prior = this.profiles.get(dir)
    this.profiles.set(dir, next)
    this.registered.delete(dir)
    await this.register([dir])
    if (this.registered.has(dir)) return
    const label = `${next.browser}${next.device ? ` (${next.device})` : ""}`
    if (!prior) {
      this.profiles.delete(dir)
      throw new Error(`The ${label} browser profile could not start.`)
    }
    // Keep the browser tools working with the profile that was running before.
    this.profiles.set(dir, prior)
    await this.register([dir])
    throw new Error(`The ${label} browser profile could not start. The previous profile was restored.`)
  }

  private static same(current: PlaywrightProfile | undefined, next: PlaywrightProfile): boolean {
    return (
      !!current &&
      current.browser === next.browser &&
      current.device === next.device &&
      current.viewport === next.viewport &&
      current.headless === next.headless
    )
  }

  private match(directory: string): string | undefined {
    const root = canonicalizePath(directory)
    return this.directories().find((dir) => samePath(canonicalizePath(dir), root))
  }

  /** A session that uses the browser owns it until its turn ends, unless another session already does. */
  private claim(session: string, directory?: string): void {
    const dir = directory ? this.match(directory) : undefined
    if (!dir || this.owners.has(dir)) return
    this.owners.set(dir, session)
  }

  private release(session: string): void {
    for (const [dir, owner] of this.owners) {
      if (owner === session) this.owners.delete(dir)
    }
  }

  ready(directory: string): Promise<void> {
    const task = this.enqueue(async () => {
      if (this.disposed || !this.enabled() || !vscode.workspace.isTrusted) return
      const dir = this.match(directory)
      // Without a profile there is no server to wait for.
      if (!dir || !this.profiles.has(dir)) return
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
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
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
      return
    }
    const folders = this.directories()
    for (const dir of this.profiles.keys()) {
      if (!folders.includes(dir)) this.profiles.delete(dir)
    }
    // Only folders where an agent picked a profile have a server.
    const dirs = folders.filter((dir) => this.profiles.has(dir))
    const removed = [...this.registered].filter((dir) => !dirs.includes(dir))
    if (removed.length) await this.unregister(removed)
    await this.register(reconcile ? dirs.filter((dir) => !this.registered.has(dir)) : dirs)
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration("kilo-code.new.browserAutomation").get<boolean>("enabled", false) === true
  }

  private directories(): string[] {
    const folders = vscode.workspace.workspaceFolders ?? []
    const dirs = folders.length > 0 ? folders.map((folder) => folder.uri.fsPath) : [process.cwd()]
    return [...new Set(dirs)]
  }

  private async register(dirs: string[]): Promise<void> {
    const client = this.getClient()
    if (!client) return
    let failure: unknown
    for (const directory of dirs) {
      const profile = this.profiles.get(directory)
      if (!profile) continue
      try {
        const command = playwrightCommand(profile)
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
    if (this.registered.size > 0) return
    if (failure) console.error("[Kilo New] BrowserAutomationService: Failed to register MCP server:", failure)
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
  }

  private getClient(): KiloClient | null {
    try {
      return this.connectionService.getClient()
    } catch {
      return null
    }
  }

  dispose(): void {
    this.disposed = true
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }
}
