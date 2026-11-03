/**
 * Agent Manager terminal manager.
 *
 * Maps Agent Manager terminal IDs to server PTY IDs. Creation, resize, close,
 * and bulk dispose all funnel through `client.pty.{create,update,remove}`. The
 * server runs a real shell and streams the output over the
 * `/api/pty/:id/connect` WebSocket. The webview connects directly to that URL,
 * so raw bytes do not travel through postMessage.
 *
 * Each socket needs its own single-use connect ticket, so the WebSocket URL is
 * minted on demand and never cached across socket opens.
 *
 * This module is vscode-free on purpose: it only talks to the Agent Manager
 * connection and whatever log helper its caller provides.
 */

import type { AgentManagerConnection } from "./connection"
import { getErrorMessage } from "./errors"
import { block, ptyMissing } from "./pty-cleanup"
import path from "node:path"

const env = { KILO_UNICODE_LOGO: "0" }

function key(directory: string) {
  const value = path.resolve(directory)
  return process.platform === "win32" ? value.toLowerCase() : value
}

/**
 * Build a fresh single-use PTY WebSocket URL.
 *
 * The ticket is bound to the PTY and its directory, so the URL carries no
 * credentials or location parameters. A reconnect must call this again.
 */
export async function ptySocketUrl(
  connection: AgentManagerConnection,
  directory: string,
  ptyID: string,
  replayExited = false,
): Promise<string> {
  const client = await connection.client()
  const server = connection.server()
  if (!server) throw new Error("Not connected to CLI backend")
  const { data } = await client.pty.connect.token({
    ptyID,
    location: { directory },
    "x-opencode-ticket": "1",
  })
  const url = new URL(`api/pty/${encodeURIComponent(ptyID)}/connect`, server.url.replace(/\/?$/, "/"))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  // The ticket is bound to the directory it was minted for, so the socket must name the same one.
  url.searchParams.set("location[directory]", directory)
  // A new terminal has one initial attachment. Replay its retained startup
  // bytes so xterm can answer shell capability queries emitted before the
  // WebSocket connected; tailing from -1 can make shells wait for a timeout.
  url.searchParams.set("cursor", "0")
  url.searchParams.set("ticket", data.ticket)
  if (replayExited) url.searchParams.set("replayExited", "1")
  return url.toString()
}

/**
 * Everything the manager needs from the surrounding AgentManagerProvider.
 */
export interface TerminalManagerDeps {
  /** The Agent Manager connection; the PTY call carries its own directory. */
  connection: AgentManagerConnection
  /** Short logger, routed to the Agent Manager output channel. */
  log(...args: unknown[]): void
}

/**
 * Bookkeeping entry kept in memory for each live terminal.
 *
 * `cwd` is stored because it is required on every PTY call: the server routes
 * each request to the directory's PTY map (it also scopes the connect ticket).
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

  /** A retired manager must stay reachable until all late allocations settle. */
  hasPendingCleanup(): boolean {
    return this.owned.size > 0 || this.creates.size > 0 || this.restarts.size > 0
  }

  /**
   * Spawn a new server PTY and record it locally.
   *
   * Returns the attach info the webview needs: our synthetic terminal ID and
   * the title. The worktreeId is round-tripped so the webview can route the tab
   * back into the correct sidebar context. Sockets go through the relay, which
   * resolves the PTY from this manager.
   */
  async create(params: {
    terminalId: string
    worktreeId: string | null
    cwd: string
    title: string
    cols?: number
    rows?: number
  }): Promise<{ terminalId: string; worktreeId: string | null; title: string }> {
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
    const entries = [...this.owned].filter((entry) => key(entry.cwd) === target)
    const results = await Promise.all(entries.map((entry) => this.closeEntry(entry)))
    if (results.some((result) => !result)) throw new Error(`Failed to close terminals in ${directory}`)
  }

  /** The server PTY behind a webview terminal, or undefined when it is gone. */
  ptyFor(terminalId: string): { ptyID: string; directory: string } | undefined {
    const entry = this.entries.get(terminalId)
    if (!entry || entry.closing) return
    return { ptyID: entry.ptyID, directory: entry.cwd }
  }

  private async createImpl(params: {
    terminalId: string
    worktreeId: string | null
    cwd: string
    title: string
    cols?: number
    rows?: number
  }): Promise<{ terminalId: string; worktreeId: string | null; title: string }> {
    const initial =
      this.pending.get(params.terminalId) ??
      (params.cols !== undefined && params.rows !== undefined ? { cols: params.cols, rows: params.rows } : undefined)
    this.pending.delete(params.terminalId)

    const client = await this.deps.connection.client()
    const created = await client.pty
      .create({
        location: { directory: params.cwd },
        cwd: params.cwd,
        title: params.title,
        // xterm's DOM renderer cannot draw the Unicode sextant glyphs used by
        // Kilo's modern wordmark, so use the compatible logo in embedded tabs.
        env,
      })
      .catch((error: unknown) => {
        throw new Error(`Failed to create PTY: ${getErrorMessage(error)}`)
      })
    const data = created.data
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
    // `pty.create` carries no size, so the initial dimensions are applied here.
    if (initial) {
      const error = await this.resizePty(entry.cwd, entry.ptyID, initial)
      if (error) this.deps.log(`Initial terminal resize failed (${params.terminalId}): ${error}`)
    }
    // If a resize arrived while pty.create was in flight that differed from
    // `initial`, apply it now.
    const queued = this.pending.get(params.terminalId)
    if (queued && (queued.cols !== initial?.cols || queued.rows !== initial?.rows)) {
      this.pending.delete(params.terminalId)
      const error = await this.resizePty(entry.cwd, entry.ptyID, queued)
      if (error) this.deps.log(`Initial terminal resize failed (${params.terminalId}): ${error}`)
    }
    this.deps.log(`Terminal created: ${params.terminalId} -> pty ${entry.ptyID} cwd=${entry.cwd}`)
    return { terminalId: params.terminalId, worktreeId: entry.worktreeId, title: entry.title }
  }

  /** Forward a size to a server PTY, returning the error message on failure. */
  private async resizePty(
    directory: string,
    ptyID: string,
    size: { cols: number; rows: number },
  ): Promise<string | undefined> {
    try {
      const client = await this.deps.connection.client()
      await client.pty.update({ location: { directory }, ptyID, size })
    } catch (error) {
      return getErrorMessage(error)
    }
  }

  /**
   * Forward a resize event to the server PTY.
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
    const error = await this.resizePty(entry.cwd, entry.ptyID, { cols, rows })
    if (error) this.deps.log(`Terminal resize failed (${terminalId}): ${error}`)
  }

  /** Titles of every live terminal in a context, used by the router to pick
   *  the lowest free "Terminal N" ordinal. */
  titles(worktreeId: string | null): string[] {
    const out: string[] = []
    for (const entry of this.entries.values()) {
      if (entry.worktreeId === worktreeId) out.push(entry.title)
    }
    return out
  }

  /** Kill a single terminal. Keep bookkeeping when the server rejects cleanup
   *  so the UI can retry. */
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
      const results =
        entry.ptys.size > 0 ? await Promise.all([...entry.ptys].map((id) => this.remove(entry, id))) : []
      if (results.some((ok) => !ok)) return false
      if (this.entries.get(entry.terminalId) === entry) {
        this.entries.delete(entry.terminalId)
      }
      this.deps.log(`Terminal closed: ${entry.terminalId} (pty ${entry.ptyID})`)
      return true
    } catch (error) {
      this.deps.log(`Terminal close failed (${entry.terminalId}): ${getErrorMessage(error)}`)
      return false
    }
  }

  /** Replace the terminal's PTY. True when the webview should open a new socket. */
  async restart(terminalId: string, cols?: number, rows?: number): Promise<boolean | undefined> {
    const entry = this.entries.get(terminalId)
    if (!entry || entry.closing) return
    const task = this.restarts.get(entry) ?? this.restartEntry(entry, entry.revision, cols, rows)
    this.restarts.set(entry, task)
    try {
      const restarted = await task
      if (!restarted || entry.closing || this.entries.get(terminalId) !== entry) return
      return true
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
   * stay owned for a later retry.
   */
  async dispose(): Promise<void> {
    this.pending.clear()
    const snapshot = [...this.owned]
    if (snapshot.length === 0) return
    this.deps.log(`Disposing ${snapshot.length} terminal(s)`)
    const results = await Promise.all(snapshot.map((entry) => this.closeEntry(entry)))
    const failed = results.filter((ok) => !ok).length
    if (failed > 0) {
      this.deps.log(`Terminal dispose: ${failed}/${snapshot.length} terminal(s) may retain PTYs until the server exits`)
    }
  }

  private release(entry: Entry): void {
    if (entry.ptys.size > 0 || this.restarts.has(entry)) return
    this.owned.delete(entry)
    if (this.entries.get(entry.terminalId) === entry) this.entries.delete(entry.terminalId)
  }

  private async remove(entry: Entry, id: string): Promise<boolean> {
    if (!entry.ptys.has(id)) return true
    try {
      const client = await this.deps.connection.client()
      await client.pty.remove({ location: { directory: entry.cwd }, ptyID: id })
      entry.ptys.delete(id)
      return true
    } catch (error) {
      // Removal may have succeeded remotely before a response was lost.
      if (ptyMissing(error, id)) {
        entry.ptys.delete(id)
        return true
      }
      this.deps.log(`Terminal PTY cleanup failed (${entry.terminalId} pty=${id}): ${getErrorMessage(error)}`)
      return false
    }
  }

  private async restartEntry(entry: Entry, revision: number, cols?: number, rows?: number): Promise<boolean> {
    try {
      const client = await this.deps.connection.client()
      const old = entry.ptyID
      const created = await client.pty.create({
        location: { directory: entry.cwd },
        cwd: entry.cwd,
        title: entry.title,
        env,
      })
      const info = created.data
      entry.ptys.add(info.id)
      try {
        if (entry.revision !== revision || this.entries.get(entry.terminalId) !== entry) return false
        if (cols !== undefined && rows !== undefined) {
          const error = await this.resizePty(entry.cwd, info.id, { cols, rows })
          if (error) throw new Error(`Failed to resize replacement PTY: ${error}`)
        }
        if (entry.revision !== revision || this.entries.get(entry.terminalId) !== entry) return false
        entry.ptyID = info.id
        await this.remove(entry, old)
        if (entry.revision !== revision || this.entries.get(entry.terminalId) !== entry) return false
        this.deps.log(`Terminal restarted (${entry.terminalId} pty=${entry.ptyID})`)
        return true
      } finally {
        if (entry.ptyID !== info.id) await this.remove(entry, info.id)
      }
    } catch (error) {
      this.deps.log(`Terminal restart failed (${entry.terminalId}): ${getErrorMessage(error)}`)
      throw error
    }
  }
}