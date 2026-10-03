/**
 * Agent Manager terminal manager.
 *
 * Maps Agent Manager terminal IDs to backend PTY IDs (from `kilo serve`).
 * Creation, resize, close, and bulk dispose all funnel through the v2 SDK
 * (`client.pty.{create,update,remove}`). The backend runs a real shell via
 * `@lydell/node-pty` and streams the output over the `/pty/:id/connect`
 * WebSocket — the webview connects directly to that URL so raw bytes do
 * not travel through postMessage.
 *
 * This module is vscode-free on purpose: it only talks to the SDK and
 * whatever log / post / WS-URL helpers its caller provides. That keeps the
 * architecture test happy and makes the manager easy to unit test.
 */

import type { KiloClient } from "@kilocode/sdk/v2/client"
import path from "node:path"
import { block } from "./pty-cleanup"

const env = { KILO_UNICODE_LOGO: "0", KILO_TERMINAL_ACTIVITY: "1" }

function key(directory: string) {
  const value = path.resolve(directory)
  return process.platform === "win32" ? value.toLowerCase() : value
}

/**
 * Everything the manager needs from the surrounding AgentManagerProvider.
 *
 * Keeping these as function dependencies rather than direct references
 * to the connection service keeps the manager trivially unit-testable
 * and lets the provider control initialization order.
 */
export interface TerminalManagerDeps {
  /** Obtain the shared SDK client. Throws when the CLI is not connected. */
  getClient(): KiloClient
  /** Build the WebSocket URL (including auth + directory query params). */
  buildWsUrl(ptyID: string, cwd: string): string
  /** Short logger, routed to the Agent Manager output channel. */
  log(...args: unknown[]): void
}

/**
 * Bookkeeping entry kept in memory for each live terminal.
 *
 * `cwd` is stored because it is required on every SDK call (the server
 * uses the `directory` query param to route requests to the right
 * per-instance PTY map — see `packages/opencode/src/server/instance/middleware.ts`).
 */
interface Entry {
  terminalId: string
  ptyID: string
  /** Includes replacements and exited PTYs until their removal succeeds. */
  ptys: Set<string>
  revision: number
  closing?: Promise<boolean>
  worktreeId: string | null
  cwd: string
  title: string
}

export class TerminalManager {
  private readonly entries = new Map<string, Entry>()
  /** Also retains closed entries with pending restarts or failed cleanup. */
  private readonly owned = new Set<Entry>()
  private readonly restarts = new Map<Entry, Promise<boolean>>()
  private readonly pending = new Map<string, { cols: number; rows: number }>()
  private readonly creates = new Map<string, Set<Promise<unknown>>>()
  private readonly blocked = new Map<string, number>()

  constructor(private readonly deps: TerminalManagerDeps) {}

  /**
   * Spawn a new backend PTY and record it locally.
   *
   * Returns the attach info the webview needs: our synthetic terminal ID,
   * the title, and the signed WebSocket URL pointing at the PTY's connect
   * endpoint. The worktreeId is round-tripped so the webview can route the
   * tab back into the correct sidebar context.
   */
  async create(params: {
    terminalId: string
    worktreeId: string | null
    cwd: string
    title: string
    cols?: number
    rows?: number
  }): Promise<{ terminalId: string; worktreeId: string | null; title: string; wsUrl: string }> {
    const directory = key(params.cwd)
    if (this.blocked.has(directory)) throw new Error(`PTY directory is being removed: ${params.cwd}`)
    const task = this.createImpl(params)
    const creates = this.creates.get(directory) ?? new Set<Promise<unknown>>()
    if (!this.creates.has(directory)) this.creates.set(directory, creates)
    creates.add(task)
    try {
      return await task
    } finally {
      creates.delete(task)
      if (creates.size === 0) this.creates.delete(directory)
    }
  }

  async blockDirectory(directory: string) {
    const target = key(directory)
    return block(target, this.blocked, this.creates.get(target))
  }

  async closeDirectory(directory: string): Promise<void> {
    const target = key(directory)
    const entries = [...this.entries.values()].filter((entry) => key(entry.cwd) === target)
    const results = await Promise.all(entries.map((entry) => this.close(entry.terminalId)))
    if (results.some((result) => !result)) throw new Error(`Failed to close terminals in ${directory}`)
  }

  private async createImpl(params: {
    terminalId: string
    worktreeId: string | null
    cwd: string
    title: string
    cols?: number
    rows?: number
  }): Promise<{ terminalId: string; worktreeId: string | null; title: string; wsUrl: string }> {
    const initial =
      this.pending.get(params.terminalId) ??
      (params.cols !== undefined && params.rows !== undefined ? { cols: params.cols, rows: params.rows } : undefined)
    this.pending.delete(params.terminalId)

    const client = this.deps.getClient()
    const { data, error } = await client.pty.create({
      directory: params.cwd,
      cwd: params.cwd,
      title: params.title,
      // xterm's DOM renderer cannot draw the Unicode sextant glyphs used by
      // Kilo's modern wordmark, so use the compatible logo in embedded tabs.
      env,
      size: initial,
    })
    if (error || !data) {
      const err = error instanceof Error ? error.message : String(error ?? "unknown error")
      throw new Error(`Failed to create PTY: ${err}`)
    }
    const entry: Entry = {
      terminalId: params.terminalId,
      ptyID: data.id,
      ptys: new Set([data.id]),
      revision: 0,
      worktreeId: params.worktreeId,
      cwd: params.cwd,
      title: data.title ?? params.title,
    }
    this.entries.set(params.terminalId, entry)
    this.owned.add(entry)
    // If a resize arrived while pty.create was in flight that differed from `initial`, apply it now.
    const latest = this.pending.get(params.terminalId)
    if (latest && (latest.cols !== initial?.cols || latest.rows !== initial?.rows)) {
      this.pending.delete(params.terminalId)
      const { error: resizeErr } = await client.pty.update({
        directory: entry.cwd,
        ptyID: entry.ptyID,
        size: latest,
      })
      if (resizeErr) {
        const err = resizeErr instanceof Error ? resizeErr.message : String(resizeErr)
        this.deps.log(`Initial terminal resize failed (${params.terminalId}): ${err}`)
      }
    }
    const wsUrl = this.deps.buildWsUrl(entry.ptyID, entry.cwd)
    this.deps.log(`Terminal created: ${params.terminalId} -> pty ${entry.ptyID} cwd=${entry.cwd}`)
    return { terminalId: params.terminalId, worktreeId: entry.worktreeId, title: entry.title, wsUrl }
  }

  /**
   * Forward a resize event to the backend PTY.
   *
   * If the terminal creation is still in flight, dimensions are queued into
   * `pending` and applied during PTY initialization before the WebSocket
   * URL is returned.
   */
  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const entry = this.entries.get(terminalId)
    if (!entry) {
      this.pending.set(terminalId, { cols, rows })
      return
    }
    this.pending.delete(terminalId)
    const client = this.deps.getClient()
    const { error } = await client.pty.update({
      directory: entry.cwd,
      ptyID: entry.ptyID,
      size: { cols, rows },
    })
    if (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.deps.log(`Terminal resize failed (${terminalId}): ${err}`)
    }
  }

  /** Titles of every live terminal in a context — used by the router to
   *  pick the lowest free "Terminal N" ordinal. */
  titles(worktreeId: string | null): string[] {
    const out: string[] = []
    for (const entry of this.entries.values()) {
      if (entry.worktreeId === worktreeId) out.push(entry.title)
    }
    return out
  }

  /** Kill a single terminal. Keep bookkeeping when the backend rejects cleanup so the UI can retry.
   *  The SDK's `pty.remove` returns `{ data, error }` without throwing
   *  on 4xx/5xx, so we have to check `error` ourselves; otherwise a
   *  failed delete would be silently logged as a successful close and
   *  the server-side PTY would linger until `kilo serve` exits. */
  async close(terminalId: string): Promise<boolean> {
    this.pending.delete(terminalId)
    const entries = [...this.owned].filter((entry) => entry.terminalId === terminalId)
    const results = await Promise.all(entries.map((entry) => this.closeEntry(entry)))
    return results.every((ok) => ok)
  }

  private closeEntry(entry: Entry): Promise<boolean> {
    if (entry.closing) return entry.closing
    // Invalidate the restart even if cleanup fails and the entry is reopened.
    entry.revision++
    const task = this.cleanup(entry)
    entry.closing = task
    return task.finally(() => {
      entry.closing = undefined
      this.release(entry)
    })
  }

  private async cleanup(entry: Entry): Promise<boolean> {
    // Do not wait for a pending create: a stalled request must not block panel
    // teardown. Its late allocation is still owned and cleaned by restartEntry.
    try {
      const client = entry.ptys.size > 0 ? this.deps.getClient() : undefined
      const results = client ? await Promise.all([...entry.ptys].map((id) => this.remove(client, entry, id))) : []
      if (results.some((ok) => !ok)) return false
      if (this.entries.get(entry.terminalId) === entry) {
        this.entries.delete(entry.terminalId)
      }
      this.deps.log(`Terminal closed: ${entry.terminalId} (pty ${entry.ptyID})`)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.deps.log(`Terminal close failed (${entry.terminalId}): ${msg}`)
      return false
    }
  }

  async restart(terminalId: string, cols?: number, rows?: number): Promise<string | undefined> {
    const entry = this.entries.get(terminalId)
    if (!entry || entry.closing) return
    const task = this.restarts.get(entry) ?? this.restartEntry(entry, entry.revision, cols, rows)
    this.restarts.set(entry, task)
    try {
      const restarted = await task
      if (!restarted || entry.closing || this.entries.get(terminalId) !== entry) return
      return this.deps.buildWsUrl(entry.ptyID, entry.cwd)
    } finally {
      if (this.restarts.get(entry) === task) this.restarts.delete(entry)
      this.release(entry)
    }
  }

  /**
   * Kill every managed terminal. Invoked from AgentManagerProvider.dispose()
   * so PTYs do not outlive a webview drop that bypasses the explicit close
   * messages.
   *
   * Closing intent is set synchronously for every owned entry. Late restart
   * allocations clean themselves up without blocking disposal. Failed removals
   * stay owned for a later retry; process-group shutdown is the final fallback
   * when the SDK is unavailable.
   */
  async dispose(): Promise<void> {
    this.pending.clear()
    const snapshot = [...this.owned]
    if (snapshot.length === 0) return
    this.deps.log(`Disposing ${snapshot.length} terminal(s)`)
    const results = await Promise.all(snapshot.map((entry) => this.closeEntry(entry)))
    const failed = results.filter((ok) => !ok).length
    if (failed > 0) {
      this.deps.log(`Terminal dispose: ${failed}/${snapshot.length} terminal(s) may retain PTYs until kilo serve exits`)
    }
  }

  private release(entry: Entry): void {
    if (entry.ptys.size > 0 || this.restarts.has(entry)) return
    this.owned.delete(entry)
    if (this.entries.get(entry.terminalId) === entry) this.entries.delete(entry.terminalId)
  }

  private async remove(client: KiloClient, entry: Entry, id: string): Promise<boolean> {
    if (!entry.ptys.has(id)) return true
    try {
      const { error } = await client.pty.remove({ directory: entry.cwd, ptyID: id })
      // Removal may have succeeded remotely before a response was lost.
      if (error && !("_tag" in error && error._tag === "PtyNotFoundError" && error.ptyID === id)) throw error
      entry.ptys.delete(id)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.deps.log(`Terminal PTY cleanup failed (${entry.terminalId} pty=${id}): ${msg}`)
      return false
    }
  }

  private async restartEntry(entry: Entry, revision: number, cols?: number, rows?: number): Promise<boolean> {
    try {
      const client = this.deps.getClient()
      const old = entry.ptyID
      const created = await client.pty.create({
        directory: entry.cwd,
        cwd: entry.cwd,
        title: entry.title,
        env,
      })
      const info = created.data
      if (created.error || !info)
        throw new Error(created.error ? String(created.error) : "PTY create returned no session")
      entry.ptys.add(info.id)
      try {
        if (entry.revision !== revision || this.entries.get(entry.terminalId) !== entry) return false
        if (cols !== undefined && rows !== undefined) {
          const { error } = await client.pty.update({
            ptyID: info.id,
            directory: entry.cwd,
            size: { cols, rows },
          })
          if (error) throw new Error(`Failed to resize replacement PTY: ${String(error)}`)
        }
        if (entry.revision !== revision || this.entries.get(entry.terminalId) !== entry) return false
        entry.ptyID = info.id
        await this.remove(client, entry, old)
        if (entry.revision !== revision || this.entries.get(entry.terminalId) !== entry) return false
        this.deps.log(`Terminal restarted (${entry.terminalId} pty=${entry.ptyID})`)
        return true
      } finally {
        if (entry.ptyID !== info.id) await this.remove(client, entry, info.id)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.deps.log(`Terminal restart failed (${entry.terminalId}): ${msg}`)
      throw error
    }
  }
}
