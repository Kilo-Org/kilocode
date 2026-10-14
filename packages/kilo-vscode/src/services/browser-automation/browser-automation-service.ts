import * as vscode from "vscode"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../cli-backend"
import { playwrightCommand } from "./settings"
import { canonicalizePath, samePath } from "../../agent-manager/project/paths"

/**
 * Manages the built-in Playwright MCP browser server for ordinary Kilo sessions.
 *
 * This is independent from the Agent Manager browser broker. It must not read
 * Agent Manager settings, and Agent Manager must not read its settings.
 */
export class BrowserAutomationService implements vscode.Disposable {
  // MCP server name used when registering with the CLI backend
  private static readonly MCP_SERVER_NAME = "kilo-playwright"
  private static readonly STATUS_ATTEMPTS = 5
  private static readonly NETWORK_CODES = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "EPIPE",
    "ECONNABORTED",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "ConnectionRefused",
    "ConnectionReset",
  ])
  private readonly disposables: vscode.Disposable[] = []
  private readonly registered = new Set<string>()
  private readonly readiness = new Map<string, Promise<void>>()
  private queue: Promise<void> = Promise.resolve()
  private disposed = false

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

  ready(directory: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(BrowserAutomationService.abortError(signal))
    const key = canonicalizePath(directory)
    if (!signal) {
      const existing = this.readiness.get(key)
      if (existing) return existing
    }
    const deadline = Date.now() + this.wait
    const task = this.enqueue(() => this.ensureReady(directory, signal, deadline))
    const promise = BrowserAutomationService.bounded(task, this.wait, signal)
    if (!signal) {
      this.readiness.set(key, promise)
      const clear = () => {
        if (this.readiness.get(key) === promise) this.readiness.delete(key)
      }
      void promise.then(clear, clear)
    }
    return promise
  }

  private async ensureReady(directory: string, signal: AbortSignal | undefined, deadline: number): Promise<void> {
    if (this.disposed || !this.enabled() || !vscode.workspace.isTrusted) return
    if (signal?.aborted) throw BrowserAutomationService.abortError(signal)
    const dir = this.directories().find((candidate) =>
      samePath(canonicalizePath(candidate), canonicalizePath(directory)),
    )
    if (!dir) return
    const client = this.getClient()
    if (!client) throw new Error("Playwright browser automation is waiting for the CLI connection.")
    const status = await this.readStatus(client, dir, signal, deadline)
    if (status === "give-up") return
    const server = status[BrowserAutomationService.MCP_SERVER_NAME]
    if (server?.status === "connected") return
    if (server?.status === "failed") throw BrowserAutomationService.failure(server.error)
    this.registered.delete(dir)
    if (signal?.aborted) throw BrowserAutomationService.abortError(signal)
    if (!this.enabled()) return
    await this.register([dir])
    if (signal?.aborted) throw BrowserAutomationService.abortError(signal)
    if (this.enabled() && !this.registered.has(dir)) throw BrowserAutomationService.failure()
  }

  private async readStatus(
    client: KiloClient,
    dir: string,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<Record<string, { status?: string; error?: string }> | "give-up"> {
    let last: unknown
    for (let attempt = 0; attempt < BrowserAutomationService.STATUS_ATTEMPTS; attempt++) {
      if (signal?.aborted) throw BrowserAutomationService.abortError(signal)
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        BrowserAutomationService.logTransport(last, "deadline")
        return "give-up"
      }
      const timeout = AbortSignal.timeout(remaining)
      const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
      try {
        const { data } = await client.mcp.status({ directory: dir }, { throwOnError: true, signal: attemptSignal })
        return data ?? {}
      } catch (error) {
        if (signal?.aborted) throw BrowserAutomationService.abortError(signal)
        if (timeout.aborted) {
          BrowserAutomationService.logTransport(last ?? error, "deadline")
          return "give-up"
        }
        if (!BrowserAutomationService.isAbort(error) && !BrowserAutomationService.isOptionalTransport(error))
          throw error
        last = error
        const delay = BrowserAutomationService.backoff(attempt, deadline - Date.now())
        if (delay <= 0 || attempt === BrowserAutomationService.STATUS_ATTEMPTS - 1) {
          BrowserAutomationService.logTransport(error)
          return "give-up"
        }
        await BrowserAutomationService.sleep(delay, signal)
      }
    }
    BrowserAutomationService.logTransport(last, "deadline")
    return "give-up"
  }

  /**
   * Cap how long a prompt waits for Playwright MCP. A cold `npx` start can hold
   * the shared queue for up to the MCP timeout, and a prompt should not stall
   * that long; its tools arrive on a later turn instead.
   */
  private static async bounded(task: Promise<void>, wait: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw BrowserAutomationService.abortError(signal)
    const limit = Promise.withResolvers<"timeout" | "abort">()
    const timer = setTimeout(() => limit.resolve("timeout"), wait)
    const onAbort = () => limit.resolve("abort")
    signal?.addEventListener("abort", onAbort, { once: true })
    let released = false
    const outcome = task.then(
      () => undefined as undefined | { error: unknown },
      (error: unknown) => {
        if (released) {
          BrowserAutomationService.observeLate(error)
          return undefined
        }
        return { error }
      },
    )
    const clear = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
    }
    void outcome.then(clear, clear)
    try {
      const result = await Promise.race([outcome, limit.promise])
      if (result === "abort" || signal?.aborted) {
        released = true
        throw BrowserAutomationService.abortError(signal)
      }
      if (result === "timeout") {
        released = true
        console.warn(
          "[Kilo New] BrowserAutomationService: readiness timed out, submitting without waiting for Playwright MCP",
        )
        return
      }
      if (result?.error) {
        if (signal?.aborted || BrowserAutomationService.isAbort(result.error)) throw result.error
        if (BrowserAutomationService.isOptionalTransport(result.error)) {
          BrowserAutomationService.logTransport(result.error)
          return
        }
        throw result.error
      }
    } finally {
      clear()
    }
  }

  private static observeLate(error: unknown): void {
    if (BrowserAutomationService.isAbort(error) || BrowserAutomationService.isOptionalTransport(error)) return
    console.warn("[Kilo New] BrowserAutomationService: readiness settled after deadline")
  }

  private static abortError(signal?: AbortSignal): Error {
    const reason = signal?.reason
    if (reason instanceof Error && reason.name === "AbortError") return reason
    return new DOMException("The operation was aborted", "AbortError")
  }

  private static isAbort(error: unknown): boolean {
    return !!error && typeof error === "object" && (error as { name?: string }).name === "AbortError"
  }

  private static httpStatus(error: unknown): number | undefined {
    if (!error || typeof error !== "object") return undefined
    const cause = (error as { cause?: unknown }).cause
    if (cause && typeof cause === "object" && typeof (cause as { status?: unknown }).status === "number") {
      return (cause as { status: number }).status
    }
    const response = (error as { response?: { status?: unknown } }).response
    return typeof response?.status === "number" ? response.status : undefined
  }

  private static isNetwork(error: unknown): boolean {
    if (!error || typeof error !== "object") return false
    const nested = (error as { cause?: { code?: unknown } }).cause
    const code = (error as { code?: unknown }).code ?? nested?.code
    if (typeof code === "string" && BrowserAutomationService.NETWORK_CODES.has(code)) return true
    if (!(error instanceof Error)) return false
    const msg = error.message.toLowerCase().trim()
    if (msg === "terminated") return true
    return (
      msg.includes("fetch failed") ||
      msg.includes("network connection was lost") ||
      msg.includes("network request failed") ||
      msg.includes("failed to fetch") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("socket hang up") ||
      msg.includes("other side closed") ||
      msg.includes("unable to connect") ||
      msg.includes("connection refused") ||
      msg.includes("connection reset")
    )
  }

  private static isOptionalTransport(error: unknown): boolean {
    if (BrowserAutomationService.isAbort(error)) return false
    const status = BrowserAutomationService.httpStatus(error)
    if (status !== undefined)
      return status === 408 || status === 429 || status === 502 || status === 503 || status === 504
    return BrowserAutomationService.isNetwork(error)
  }

  private static logTransport(error: unknown, kind: "transport" | "deadline" = "transport"): void {
    const status = BrowserAutomationService.httpStatus(error)
    const detail = status
      ? `HTTP ${status}`
      : BrowserAutomationService.isNetwork(error) || BrowserAutomationService.isAbort(error)
        ? "network"
        : kind === "deadline"
          ? "deadline"
          : "network"
    console.warn(
      `[Kilo New] BrowserAutomationService: optional MCP status ${detail}; submitting without waiting for Playwright`,
    )
  }

  private static backoff(attempt: number, remaining: number): number {
    if (remaining <= 0) return 0
    return Math.min(400, 20 * 2 ** attempt, remaining)
  }

  private static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(BrowserAutomationService.abortError(signal))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }, ms)
      function onAbort() {
        clearTimeout(timer)
        reject(BrowserAutomationService.abortError(signal))
      }
      signal?.addEventListener("abort", onAbort, { once: true })
    })
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
    if (!client) return
    const command = this.command()
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
