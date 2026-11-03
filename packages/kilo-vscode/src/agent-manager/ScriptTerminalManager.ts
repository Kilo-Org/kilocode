import type { AgentManagerConnection } from "./connection"
import type { TerminalFont } from "./terminal-font"
import { message, type RunHandle } from "./run/manager"
import { block, ptyMissing } from "./pty-cleanup"
import path from "node:path"

export type ScriptTerminalKind = "run" | "setup"
type ScriptTerminalState = "running" | "stopping" | "exited" | "failed"

const TITLE: Record<ScriptTerminalKind, "Run" | "Setup"> = { run: "Run", setup: "Setup" }

interface ScriptTerminalConfig {
  projectId?: string
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
  projectId?: string
  /** null for the LOCAL workspace; RunController retains its internal "local" key. */
  worktreeId: string | null
  kind: ScriptTerminalKind
  title: "Run" | "Setup"
  state: ScriptTerminalState
  exitCode?: number
  font: TerminalFont
}

interface ScriptTerminalDeps {
  connection: AgentManagerConnection
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
  projectId?: string
  worktreeId: string
  cwd: string
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

function key(kind: ScriptTerminalKind, worktreeId: string, projectId?: string): string {
  return `${projectId ?? "single"}:${kind}:${worktreeId}`
}

function directoryKey(directory: string) {
  const value = path.resolve(directory)
  return process.platform === "win32" ? value.toLowerCase() : value
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
  private readonly creates = new Map<string, Set<Promise<unknown>>>()
  private readonly blocked = new Map<string, number>()

  constructor(private readonly deps: ScriptTerminalDeps) {}

  async start(
    kind: ScriptTerminalKind,
    config: ScriptTerminalConfig,
    done: (exit: ScriptTerminalExit) => void,
  ): Promise<RunHandle> {
    const directory = directoryKey(config.cwd)
    if (this.blocked.has(directory)) throw new Error(`PTY directory is being removed: ${config.cwd}`)
    const task = this.startImpl(kind, config, done)
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
    const target = directoryKey(directory)
    return block(target, this.blocked, this.creates.get(target))
  }

  async closeDirectory(directory: string): Promise<void> {
    const target = directoryKey(directory)
    const entries = [...this.entries.values()].filter((entry) => directoryKey(entry.cwd) === target)
    const results = await Promise.all(entries.map((entry) => this.close(entry.terminalId, true)))
    if (results.some((result) => !result)) throw new Error(`Failed to close script terminals in ${directory}`)
  }

  private async startImpl(
    kind: ScriptTerminalKind,
    config: ScriptTerminalConfig,
    done: (exit: ScriptTerminalExit) => void,
  ): Promise<RunHandle> {
    const id = key(kind, config.worktreeId, config.projectId)
    const prior = this.entries.get(id)
    if (prior) {
      if (prior.state === "running" || prior.state === "stopping")
        throw new Error(`${TITLE[kind]} terminal is already active`)
      await this.remove(prior, false)
      if (this.entries.has(id)) throw new Error(`Failed to remove previous ${TITLE[kind]} terminal`)
    }

    const client = await this.deps.connection.client().catch((error: unknown) => {
      const detail = message(error)
      this.deps.log(`${TITLE[kind]} terminal create failed: ${detail}`)
      throw new Error(detail)
    })
    const created = await client.pty
      .create({
        location: { directory: config.cwd },
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: config.env,
        title: TITLE[kind],
      })
      .catch((error: unknown) => {
        const detail = message(error)
        this.deps.log(`${TITLE[kind]} terminal create failed: ${detail}`)
        throw new Error(detail)
      })
    const pty = created.data

    const entry: Entry = {
      key: id,
      kind,
      terminalId: terminalId(),
      ptyID: pty.id,
      projectId: config.projectId,
      worktreeId: config.worktreeId,
      cwd: config.cwd,
      state: "running",
      done,
      finished: false,
    }
    this.entries.set(entry.key, entry)
    this.terminals.set(entry.terminalId, entry)
    this.ptys.set(entry.ptyID, entry)
    this.emit()

    await this.reconcile(entry)

    return {
      stop: () => this.stop(entry),
      kill: (reason) => this.kill(entry, reason),
    }
  }

  /** Return true only for close/resize/attach messages owned by a script terminal. */
  intercept(msg: TerminalMessage): boolean {
    const id = msg.terminalId
    if (typeof id !== "string" || !this.terminals.has(id)) return false
    if (msg.type === "agentManager.terminal.close") {
      void this.close(id).then((closed) => {
        if (closed) this.deps.closed(id)
      })
      return true
    }
    if (msg.type === "agentManager.terminal.stop") {
      // Deliberate user stop: always allowed, even for a running Setup
      // script whose accidental close is blocked.
      void this.close(id, true).then((closed) => {
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
    if (!entry) return
    this.finishExited(entry, exitCode)
  }

  deleted(ptyID: string): void {
    const entry = this.ptys.get(ptyID)
    if (!entry) return
    const state = entry.state
    if (state === "failed") {
      // Retained failure (e.g. after a timeout kill): the server PTY is
      // gone now, but the tab and its output stay until the user closes it.
      this.ptys.delete(ptyID)
      return
    }
    this.drop(entry)
    this.emit()
    if (state === "stopping") {
      this.done(entry, { stopped: true })
      return
    }
    if (state === "running") this.done(entry, { error: `${TITLE[entry.kind]} terminal was removed before it exited` })
  }

  /** Re-post every script terminal after a webview reload. */
  snapshot(): void {
    this.emit()
  }

  /** The server PTY behind a script terminal, for the host socket relay. */
  ptyFor(terminalId: string): { ptyID: string; directory: string; replayExited: boolean } | undefined {
    const entry = this.terminals.get(terminalId)
    // A script can finish before its tab connects, so the tab replays the retained output of an exited PTY.
    return entry ? { ptyID: entry.ptyID, directory: entry.cwd, replayExited: true } : undefined
  }

  owns(ptyID: string): boolean {
    return this.ptys.has(ptyID)
  }

  /** True while a script of this kind is running or stopping for the worktree. */
  active(kind: ScriptTerminalKind, worktreeId: string, projectId?: string): boolean {
    const entry = this.entries.get(key(kind, worktreeId, projectId))
    return entry?.state === "running" || entry?.state === "stopping"
  }

  async sync(): Promise<void> {
    const directories = new Map<string, Entry[]>()
    for (const entry of this.entries.values()) {
      const list = directories.get(entry.cwd) ?? []
      list.push(entry)
      directories.set(entry.cwd, list)
    }
    await Promise.all(
      [...directories].map(async ([directory, entries]) => {
        const client = await this.deps.connection.client().catch((error: unknown) => {
          this.deps.log(`Failed to reconnect script terminals: ${message(error)}`)
          return undefined
        })
        if (!client) return
        const listed = await client.pty.list({ location: { directory } }).catch((error: unknown) => {
          this.deps.log(`Failed to list script terminals: ${message(error)}`)
          return undefined
        })
        if (!listed) return
        for (const entry of entries) this.reconcileEntry(entry, listed.data)
      }),
    )
  }

  async clear(kind: ScriptTerminalKind, worktreeId: string, projectId?: string): Promise<boolean> {
    const entry = this.entries.get(key(kind, worktreeId, projectId))
    if (!entry) return true
    return this.close(entry.terminalId, true)
  }

  /**
   * User-initiated tab close. A running Setup script must keep its output
   * and finish (or time out) on its own, so only forced paths (worktree
   * deletion, shutdown, timeout) may tear it down early.
   */
  async close(terminalId: string, force = false): Promise<boolean> {
    const entry = this.terminals.get(terminalId)
    if (!entry) return true
    if (!force && entry.kind === "setup" && (entry.state === "running" || entry.state === "stopping")) {
      this.deps.log(`Ignored close for ${TITLE[entry.kind]} terminal while it is running`)
      return false
    }
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
      const client = await this.deps.connection.client()
      await client.pty.update({
        ptyID: entry.ptyID,
        location: { directory: entry.cwd },
        size: { cols, rows },
      })
    } catch (error) {
      this.deps.log(`${TITLE[entry.kind]} terminal resize failed (${terminalId}): ${message(error)}`)
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.terminals.keys()].map((terminalId) => this.close(terminalId, true)))
  }

  private async reconcile(entry: Entry): Promise<void> {
    if (!this.current(entry)) return
    try {
      const client = await this.deps.connection.client()
      const listed = await client.pty.list({ location: { directory: entry.cwd } })
      this.reconcileEntry(entry, listed.data)
    } catch (error) {
      this.deps.log(`Failed to read ${TITLE[entry.kind]} terminal: ${message(error)}`)
    }
  }

  private reconcileEntry(entry: Entry, ptys: ReadonlyArray<{ id: string; status: string; exitCode?: number }>): void {
    if (!this.current(entry)) return
    const pty = ptys.find((item) => item.id === entry.ptyID)
    if (!pty) {
      this.missing(entry, `${TITLE[entry.kind]} terminal is no longer available`)
      return
    }
    if (pty.status === "exited") this.finishExited(entry, pty.exitCode ?? 0)
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
      const client = await this.deps.connection.client()
      await client.pty.remove({ ptyID: entry.ptyID, location: { directory: entry.cwd } })
      this.drop(entry)
      this.emit()
      if (stopped) this.done(entry, { stopped: true })
    } catch (error) {
      if (ptyMissing(error, entry.ptyID)) {
        this.drop(entry)
        this.emit()
        if (stopped) this.done(entry, { stopped: true })
        return
      }
      this.failed(entry, `Failed to remove ${TITLE[entry.kind]} terminal: ${message(error)}`)
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

  /**
   * Kill the process tree but retain the terminal as failed with its
   * partial output. Timeouts use this so the user can see how far the
   * script got; user-initiated stops use stop() and drop the tab instead.
   */
  private kill(entry: Entry, reason: string): void {
    if (!this.current(entry) || (entry.state !== "running" && entry.state !== "stopping")) return
    entry.state = "failed"
    this.emit()
    void this.deps.connection
      .client()
      .then((client) => client.pty.remove({ ptyID: entry.ptyID, location: { directory: entry.cwd } }))
      .catch((error: unknown) => {
        this.deps.log(`Failed to kill ${TITLE[entry.kind]} terminal: ${message(error)}`)
      })
    this.deps.log(reason)
    this.done(entry, { error: reason })
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
      const local = entry.worktreeId === "local" || entry.worktreeId.endsWith(":local")
      const terminal: ScriptTerminalView = {
        terminalId: entry.terminalId,
        ...(entry.projectId ? { projectId: entry.projectId } : {}),
        worktreeId: local ? null : entry.worktreeId,
        kind: entry.kind,
        title: TITLE[entry.kind],
        state: entry.state,
        font: this.deps.getTerminalFont(),
      }
      if (entry.exitCode !== undefined) terminal.exitCode = entry.exitCode
      terminals.push(terminal)
    }
    this.deps.emit(terminals)
  }
}