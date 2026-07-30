import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { TerminalFont } from "./terminal-font"
import type { RunHandle } from "./run/manager"

type ScriptTerminalKind = "run"
type ScriptTerminalState = "running" | "stopping" | "exited" | "failed"

interface ScriptTerminalConfig {
  worktreeId: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}

interface ScriptTerminalExit {
  exitCode?: number
  stopped?: boolean
  error?: string
}

export interface ScriptTerminalView {
  terminalId: string
  /** null for the LOCAL workspace; RunController retains its internal "local" key. */
  worktreeId: string | null
  kind: ScriptTerminalKind
  title: "Run"
  wsUrl: string
  state: ScriptTerminalState
  exitCode?: number
  font: TerminalFont
}

interface ScriptTerminalDeps {
  getClient(): KiloClient
  getClientAsync(directory: string): Promise<KiloClient>
  buildWsUrl(ptyID: string, cwd: string): string
  getTerminalFont(): TerminalFont
  emit(terminals: ScriptTerminalView[]): void
  closed(terminalId: string): void
  log(msg: string): void
}

interface Entry {
  key: string
  kind: ScriptTerminalKind
  terminalId: string
  ptyID: string
  worktreeId: string
  cwd: string
  wsUrl: string
  state: ScriptTerminalState
  exitCode?: number
  done: (exit: ScriptTerminalExit) => void
  finished: boolean
  closing?: Promise<void>
}

interface TerminalMessage {
  type: string
  terminalId?: unknown
  cols?: unknown
  rows?: unknown
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function key(kind: ScriptTerminalKind, worktreeId: string): string {
  return `${kind}:${worktreeId}`
}

function terminalId(): string {
  return `script:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Owns extension-host script PTYs independently from webview terminal routing.
 * Exited records stay available for output replay until the user closes them.
 */
export class ScriptTerminalManager {
  private readonly entries = new Map<string, Entry>()
  private readonly terminals = new Map<string, Entry>()
  private readonly ptys = new Map<string, Entry>()
  private readonly early = new Map<string, number>()

  constructor(private readonly deps: ScriptTerminalDeps) {}

  async start(
    kind: ScriptTerminalKind,
    config: ScriptTerminalConfig,
    done: (exit: ScriptTerminalExit) => void,
  ): Promise<RunHandle> {
    const id = key(kind, config.worktreeId)
    const prior = this.entries.get(id)
    if (prior) {
      if (prior.state === "running" || prior.state === "stopping") throw new Error("Run terminal is already active")
      await this.remove(prior, false)
      if (this.entries.has(id)) throw new Error("Failed to remove previous Run terminal")
    }

    const client = await this.deps.getClientAsync(config.cwd).catch((error) => {
      const detail = message(error)
      this.deps.log(`Run terminal create failed: ${detail}`)
      throw new Error(detail)
    })
    const created = await client.v2.pty
      .create({
        location: { directory: config.cwd },
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: config.env,
        title: "Run",
      })
      .catch((error) => {
        const detail = message(error)
        this.deps.log(`Run terminal create failed: ${detail}`)
        throw new Error(detail)
      })
    const pty = created.data?.data
    if (created.error || !pty) {
      const detail = message(created.error ?? "unknown error")
      this.deps.log(`Run terminal create failed: ${detail}`)
      throw new Error(`Failed to create Run terminal: ${detail}`)
    }

    const wsUrl = await this.url(client, pty.id, config.cwd)
    const entry: Entry = {
      key: id,
      kind,
      terminalId: terminalId(),
      ptyID: pty.id,
      worktreeId: config.worktreeId,
      cwd: config.cwd,
      wsUrl,
      state: "running",
      done,
      finished: false,
    }
    this.entries.set(entry.key, entry)
    this.terminals.set(entry.terminalId, entry)
    this.ptys.set(entry.ptyID, entry)
    this.emit()

    const exit = this.early.get(entry.ptyID)
    if (exit !== undefined) {
      this.early.delete(entry.ptyID)
      this.finishExited(entry, exit)
    }
    await this.reconcile(entry, client)

    return {
      stop: () => this.stop(entry),
    }
  }

  /** Return true only for close/resize messages owned by a script terminal. */
  intercept(msg: TerminalMessage): boolean {
    const id = msg.terminalId
    if (typeof id !== "string" || !this.terminals.has(id)) return false
    if (msg.type === "agentManager.terminal.close") {
      void this.close(id).then((closed) => {
        if (closed) this.deps.closed(id)
      })
      return true
    }
    if (msg.type !== "agentManager.terminal.resize") return false
    if (typeof msg.cols !== "number" || typeof msg.rows !== "number") return true
    void this.resize(id, msg.cols, msg.rows)
    return true
  }

  exited(ptyID: string, exitCode: number): void {
    const entry = this.ptys.get(ptyID)
    if (!entry) {
      if (this.early.size >= 100) {
        const first = this.early.keys().next().value
        if (typeof first === "string") this.early.delete(first)
      }
      this.early.set(ptyID, exitCode)
      return
    }
    this.finishExited(entry, exitCode)
  }

  deleted(ptyID: string): void {
    this.early.delete(ptyID)
    const entry = this.ptys.get(ptyID)
    if (!entry) return
    const state = entry.state
    this.drop(entry)
    this.emit()
    if (state === "stopping") {
      this.done(entry, { stopped: true })
      return
    }
    if (state === "running") this.done(entry, { error: "Run terminal was removed before it exited" })
  }

  snapshot(): void {
    this.emit()
  }

  async sync(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        const client = await this.deps.getClientAsync(entry.cwd).catch((error) => {
          this.deps.log(`Failed to reconnect Run terminal: ${message(error)}`)
          return undefined
        })
        if (client) await this.reconcile(entry, client)
      }),
    )
  }

  async clear(kind: ScriptTerminalKind, worktreeId: string): Promise<boolean> {
    const entry = this.entries.get(key(kind, worktreeId))
    if (!entry) return true
    return this.close(entry.terminalId)
  }

  async close(terminalId: string): Promise<boolean> {
    const entry = this.terminals.get(terminalId)
    if (!entry) return true
    if (entry.state === "running") {
      await this.stop(entry)
      return !this.terminals.has(terminalId)
    }
    if (entry.state === "stopping") {
      await entry.closing
      return !this.terminals.has(terminalId)
    }
    await this.remove(entry, false)
    return !this.terminals.has(terminalId)
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    const entry = this.terminals.get(terminalId)
    if (!entry) return
    try {
      const client = this.deps.getClient()
      const result = await client.v2.pty.update({
        ptyID: entry.ptyID,
        location: { directory: entry.cwd },
        size: { cols, rows },
      })
      if (!result.error) return
      this.deps.log(`Run terminal resize failed (${terminalId}): ${message(result.error)}`)
    } catch (error) {
      this.deps.log(`Run terminal resize failed (${terminalId}): ${message(error)}`)
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.terminals.keys()].map((terminalId) => this.close(terminalId)))
  }

  private async reconcile(entry: Entry, client: KiloClient): Promise<void> {
    if (!this.current(entry)) return
    try {
      const result = await client.v2.pty.get({ ptyID: entry.ptyID, location: { directory: entry.cwd } })
      const pty = result.data?.data
      if (result.error || !pty) {
        this.missing(entry, `Run terminal is no longer available: ${message(result.error ?? "unknown error")}`)
        return
      }
      if (pty.status === "exited") this.finishExited(entry, pty.exitCode ?? 0)
    } catch (error) {
      this.deps.log(`Failed to read Run terminal: ${message(error)}`)
    }
  }

  private async stop(entry: Entry): Promise<void> {
    if (!this.current(entry)) return
    if (entry.state === "stopping") {
      await entry.closing
      return
    }
    if (entry.state === "exited" || entry.state === "failed") {
      await this.remove(entry, false)
      return
    }
    entry.state = "stopping"
    this.emit()
    await this.remove(entry, true)
  }

  private remove(entry: Entry, stopped: boolean): Promise<void> {
    if (entry.closing) return entry.closing
    const task = this.removeEntry(entry, stopped)
    entry.closing = task
    void task.finally(() => {
      if (this.current(entry) && entry.closing === task) entry.closing = undefined
    })
    return task
  }

  private async removeEntry(entry: Entry, stopped: boolean): Promise<void> {
    try {
      const client = await this.deps.getClientAsync(entry.cwd)
      const result = await client.v2.pty.remove({ ptyID: entry.ptyID, location: { directory: entry.cwd } })
      if (result.error) {
        this.failed(entry, `Failed to remove Run terminal: ${message(result.error)}`)
        return
      }
      this.drop(entry)
      this.emit()
      if (stopped) this.done(entry, { stopped: true })
    } catch (error) {
      this.failed(entry, `Failed to remove Run terminal: ${message(error)}`)
    }
  }

  private async url(client: KiloClient, ptyID: string, cwd: string): Promise<string> {
    try {
      return this.deps.buildWsUrl(ptyID, cwd)
    } catch (error) {
      this.deps.log(`Failed to build Run terminal URL: ${message(error)}`)
      try {
        const result = await client.v2.pty.remove({ ptyID, location: { directory: cwd } })
        if (result.error) this.deps.log(`Failed to remove Run terminal after URL failure: ${message(result.error)}`)
      } catch (cleanup) {
        this.deps.log(`Failed to remove Run terminal after URL failure: ${message(cleanup)}`)
      }
      throw error
    }
  }

  private finishExited(entry: Entry, exitCode: number): void {
    if (!this.current(entry) || entry.state === "exited") return
    entry.state = "exited"
    entry.exitCode = exitCode
    this.emit()
    this.done(entry, { exitCode })
  }

  private failed(entry: Entry, error: string): void {
    if (!this.current(entry)) return
    this.deps.log(error)
    entry.state = "failed"
    this.emit()
    this.done(entry, { error })
  }

  private missing(entry: Entry, error: string): void {
    if (!this.current(entry)) return
    this.deps.log(error)
    this.drop(entry)
    this.emit()
    this.done(entry, { error })
  }

  private done(entry: Entry, exit: ScriptTerminalExit): void {
    if (entry.finished) return
    entry.finished = true
    entry.done(exit)
  }

  private drop(entry: Entry): void {
    if (!this.current(entry)) return
    this.entries.delete(entry.key)
    this.terminals.delete(entry.terminalId)
    this.ptys.delete(entry.ptyID)
  }

  private current(entry: Entry): boolean {
    return this.entries.get(entry.key) === entry
  }

  private emit(): void {
    const terminals: ScriptTerminalView[] = []
    for (const entry of this.entries.values()) {
      const terminal: ScriptTerminalView = {
        terminalId: entry.terminalId,
        worktreeId: entry.worktreeId === "local" ? null : entry.worktreeId,
        kind: entry.kind,
        title: "Run",
        wsUrl: entry.wsUrl,
        state: entry.state,
        font: this.deps.getTerminalFont(),
      }
      if (entry.exitCode !== undefined) terminal.exitCode = entry.exitCode
      terminals.push(terminal)
    }
    this.deps.emit(terminals)
  }
}
