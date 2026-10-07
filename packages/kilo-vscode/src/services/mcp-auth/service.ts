import type { KiloClient, McpStatus } from "@kilocode/sdk/v2/client"
import * as vscode from "vscode"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import { needsAuthNames } from "./status"

/**
 * The subset of `KiloConnectionService` the auth service depends on.
 * `KiloConnectionService` satisfies this structurally — kept narrow so
 * tests can supply a fake without constructing a real connection.
 */
export interface McpAuthConnection {
  getClientAsync(dir?: string): Promise<KiloClient>
  onEvent(listener: (event: SSEPayload, directory?: string) => void): () => void
}

export type McpAuthStatus =
  | "connected"
  | "failed"
  | "cancelled"
  | "timeout"
  | "unsupported"
  | "not_found"
  | "disabled"
  | "needs_auth"
  | "needs_client_registration"

export interface McpAuthResult {
  status: McpAuthStatus
  error?: string
}

export interface McpAuthOpts {
  /** Milliseconds before a sign-in attempt is abandoned client-side. Default 6 minutes, kept above the CLI's 5-minute OAuth callback timeout so the CLI's own error reaches the user first. */
  timeout?: number
  /** Milliseconds within which repeated browser URL events for the same URL are collapsed. Default 4 seconds. */
  dedupe?: number
  /** Fallback used when VS Code cannot open an authorization URL. */
  onUrl?: (name: string, url: string) => void
}

const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000
const DEFAULT_DEDUPE_MS = 4000
const MAX_DIRECTORIES = 64

function busyKey(dir: string, name: string): string {
  return `${dir}\0${name}`
}

/**
 * Owns MCP OAuth sign-in state for every directory on the shared connection.
 * Settings, the chat prompt's session-issues indicator, and the Marketplace
 * post-install prompt are all pure consumers of this service so they agree
 * on which servers need sign-in and whether one is in progress.
 *
 * Mirrors `KiloMcpAuthService` from the JetBrains plugin (packages/kilo-jetbrains).
 */
export class McpAuthService {
  private connection: McpAuthConnection
  private timeout: number
  private dedupeWindow: number
  private onUrl?: (name: string, url: string) => void

  private needsAuthByDir = new Map<string, Set<string>>()
  private busyKeys = new Set<string>()
  private active = new Map<string, object>()
  private refreshes = new Map<string, Promise<Record<string, McpStatus> | undefined>>()
  private cancelled = new Set<object>()
  private listeners = new Set<(dir: string) => void>()
  private lastUrl: string | undefined
  private lastUrlAt = 0
  private unsubEvent: (() => void) | undefined

  constructor(connection: McpAuthConnection, opts: McpAuthOpts = {}) {
    this.connection = connection
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS
    this.dedupeWindow = opts.dedupe ?? DEFAULT_DEDUPE_MS
    this.onUrl = opts.onUrl
    this.start()
  }

  /** Sorted names of servers currently reporting `needs_auth` for a directory. */
  needsAuth(dir: string): string[] {
    return [...(this.needsAuthByDir.get(dir) ?? [])].sort()
  }

  /** Sorted names of servers with an in-flight sign-in for a directory. */
  busy(dir: string): string[] {
    const prefix = `${dir}\0`
    return [...this.busyKeys]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort()
  }

  /** Subscribe to changes. Called with the affected directory. Returns an unsubscribe function. */
  onChange(listener: (dir: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Refresh `needsAuth` for a directory from the CLI. Returns the resulting sorted list. */
  async refresh(dir: string): Promise<string[]> {
    await this.refreshStatus(dir)
    return this.needsAuth(dir)
  }

  /** Refresh auth state and return the same MCP status snapshot used to derive it. */
  refreshStatus(dir: string): Promise<Record<string, McpStatus> | undefined> {
    if (!dir) return Promise.resolve({})
    const active = this.refreshes.get(dir)
    if (active) return active
    const refresh = this.performStatusRefresh(dir).finally(() => {
      if (this.refreshes.get(dir) === refresh) this.refreshes.delete(dir)
    })
    this.refreshes.set(dir, refresh)
    return refresh
  }

  private async performStatusRefresh(dir: string): Promise<Record<string, McpStatus> | undefined> {
    const status = await this.attempt<Record<string, McpStatus> | undefined>(
      `mcp status for ${dir}`,
      undefined,
      async () => {
        const client = await this.connection.getClientAsync(dir)
        const { data } = await client.mcp.status({ directory: dir })
        return data ?? {}
      },
    )
    if (!status) return undefined
    this.updateNeedsAuth(dir, new Set(needsAuthNames(status)))
    return status
  }

  /**
   * Start (or join) a sign-in attempt. Single-flight per (dir, name): a
   * concurrent call for the same pair returns `failed` immediately without
   * issuing a second request. Always refreshes `needsAuth` afterwards.
   */
  async signIn(dir: string, name: string): Promise<McpAuthResult> {
    const key = busyKey(dir, name)
    const token = {}
    if (this.active.has(key)) return { status: "failed" }
    this.active.set(key, token)
    this.setBusy(key, true)
    try {
      const result = await this.race(dir, name)
      if (result === "timeout") {
        await this.cancel(dir, name)
        return { status: "timeout" }
      }
      if (this.cancelled.has(token)) return { status: "cancelled" }
      return result
    } finally {
      this.active.delete(key)
      this.cancelled.delete(token)
      this.setBusy(key, false)
      await this.refresh(dir)
    }
  }

  /** Cancel an in-flight sign-in without deleting stored credentials. */
  async cancel(dir: string, name: string): Promise<boolean> {
    const token = this.active.get(busyKey(dir, name))
    if (token) this.cancelled.add(token)
    const cancelled = await this.attempt(`mcp auth cancel for ${name}`, false, async () => {
      const client = await this.connection.getClientAsync(dir)
      const { response } = await client.mcp.auth.cancel({ name, directory: dir })
      return response?.ok === true
    })
    if (!cancelled && token) this.cancelled.delete(token)
    return cancelled
  }

  /** Clear stored credentials and reconnect so the server reports `needs_auth` again immediately. */
  async reset(dir: string, name: string): Promise<boolean> {
    const token = this.active.get(busyKey(dir, name))
    if (token) this.cancelled.add(token)
    const removed = await this.attempt(`mcp auth reset for ${name}`, false, async () => {
      const client = await this.connection.getClientAsync(dir)
      const { response } = await client.mcp.auth.remove({ name, directory: dir })
      return response?.ok === true
    })
    if (!removed) {
      if (token) this.cancelled.delete(token)
      return false
    }
    let reconnected = false
    try {
      const disconnected = await this.attempt(`mcp disconnect for ${name}`, false, async () => {
        const client = await this.connection.getClientAsync(dir)
        const { data } = await client.mcp.disconnect({ name, directory: dir })
        return data === true
      })
      const connected = await this.attempt(`mcp connect for ${name}`, false, async () => {
        const client = await this.connection.getClientAsync(dir)
        const { data } = await client.mcp.connect({ name, directory: dir })
        return data === true
      })
      reconnected = disconnected && connected
      return reconnected
    } finally {
      await this.refresh(dir)
      if (!reconnected) this.markNeedsAuth(dir, name)
    }
  }

  dispose(): void {
    this.unsubEvent?.()
    this.unsubEvent = undefined
    this.listeners.clear()
  }

  /** Race `mcp.auth.authenticate` against the client-side timeout. */
  private async race(dir: string, name: string): Promise<McpAuthResult | "timeout"> {
    return new Promise((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve("timeout")
      }, this.timeout)

      void this.authenticate(dir, name).then((result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      })
    })
  }

  private async authenticate(dir: string, name: string): Promise<McpAuthResult> {
    return this.attempt(`mcp authenticate for ${name}`, { status: "failed" }, async (): Promise<McpAuthResult> => {
      const client = await this.connection.getClientAsync(dir)
      const { data, error, response } = await client.mcp.auth.authenticate({ name, directory: dir, external: true })
      if (response?.ok && data) {
        const status: McpAuthStatus = data.status
        return { status, error: "error" in data ? data.error : undefined }
      }
      if (response?.status === 400) return { status: "unsupported", error: errorText(error) }
      if (response?.status === 404) return { status: "not_found", error: errorText(error) }
      return { status: "failed", error: errorText(error) ?? `HTTP ${response?.status ?? "unknown"}` }
    })
  }

  private setBusy(key: string, value: boolean): void {
    if (value === this.busyKeys.has(key)) return
    if (value) this.busyKeys.add(key)
    else this.busyKeys.delete(key)
    const [dir] = key.split("\0")
    if (dir) this.notify(dir)
  }

  private updateNeedsAuth(dir: string, names: Set<string>): void {
    const existing = this.needsAuthByDir.get(dir)
    if (existing && sameSet(existing, names)) return
    this.needsAuthByDir.delete(dir)
    this.needsAuthByDir.set(dir, names)
    while (this.needsAuthByDir.size > MAX_DIRECTORIES) {
      const oldest = this.needsAuthByDir.keys().next().value
      if (oldest === undefined) break
      this.needsAuthByDir.delete(oldest)
    }
    this.notify(dir)
  }

  private markNeedsAuth(dir: string, name: string): void {
    const existing = new Set(this.needsAuthByDir.get(dir) ?? [])
    existing.add(name)
    this.updateNeedsAuth(dir, existing)
  }

  private notify(dir: string): void {
    for (const listener of this.listeners) listener(dir)
  }

  private start(): void {
    // Defensive: some callers (notably test doubles for KiloConnectionService)
    // implement only the client-fetching surface, not events. Skipping the
    // subscription there is harmless — it only handles authorization URLs,
    // which those callers don't exercise.
    if (typeof this.connection.onEvent !== "function") return
    this.unsubEvent = this.connection.onEvent((event, dir) => {
      if (event.type === "mcp.browser.open.failed") {
        this.onBrowserOpenFailed(event.properties.mcpName, event.properties.url)
        return
      }
      if (event.type !== "mcp.auth.url" || !dir) return
      this.onAuthUrl(dir, event.properties.mcpName, event.properties.url)
    })
  }

  private onBrowserOpenFailed(name: string, url: string): void {
    if (!this.acceptUrl(url)) return
    this.onUrl?.(name, url)
  }

  private onAuthUrl(dir: string, name: string, url: string): void {
    if (!this.active.has(busyKey(dir, name))) return
    if (!this.acceptUrl(url)) return
    void Promise.resolve()
      .then(() => vscode.env.openExternal(vscode.Uri.parse(url)))
      .then(
        (opened) => {
          if (!opened) this.onUrl?.(name, url)
        },
        () => this.onUrl?.(name, url),
      )
  }

  private acceptUrl(url: string): boolean {
    const now = Date.now()
    if (url === this.lastUrl && now - this.lastUrlAt < this.dedupeWindow) return false
    this.lastUrl = url
    this.lastUrlAt = now
    return true
  }

  private async attempt<T>(message: string, fallback: T, block: () => Promise<T>): Promise<T> {
    try {
      return await block()
    } catch (error) {
      console.error(`[Kilo New] McpAuthService: ${message} failed:`, error)
      return fallback
    }
  }
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

function errorText(error: unknown): string | undefined {
  if (!error) return undefined
  if (typeof error === "string") return error
  if (typeof error !== "object") return undefined
  const obj = error as Record<string, unknown>
  if (typeof obj.error === "string") return obj.error
  if (typeof obj.message === "string") return obj.message
  return undefined
}

export type { KiloClient }
