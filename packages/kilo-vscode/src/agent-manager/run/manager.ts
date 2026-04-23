export type RunState = "idle" | "running" | "stopping"

export interface RunStatus {
  worktreeId: string
  state: RunState
  exitCode?: number
  signal?: string
  startedAt?: string
  finishedAt?: string
  error?: string
}

export interface RunHandle {
  stop(): void
  dispose?(): void
}

interface Entry {
  status: RunStatus
  handle?: RunHandle
}

interface FinishOptions {
  exitCode?: number
  signal?: string
  error?: string
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export class RunScriptManager {
  private entries = new Map<string, Entry>()
  private removed = new Set<string>()

  constructor(
    private readonly log: (msg: string) => void,
    private readonly emit: (status: RunStatus) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(worktreeId: string, start: () => Promise<RunHandle>): Promise<boolean> {
    const current = this.entries.get(worktreeId)
    if (current && current.status.state !== "idle") return false

    const entry: Entry = {
      status: {
        worktreeId,
        state: "running",
        startedAt: this.now().toISOString(),
      },
    }
    this.entries.set(worktreeId, entry)
    this.emit(entry.status)

    try {
      const handle = await start()
      const latest = this.entries.get(worktreeId)
      if (latest !== entry) {
        handle.dispose?.()
        return true
      }
      entry.handle = handle
      if (entry.status.state === "stopping") handle.stop()
    } catch (error) {
      this.finish(worktreeId, { error: message(error) })
    }
    return true
  }

  stop(worktreeId: string): void {
    const entry = this.entries.get(worktreeId)
    if (!entry || entry.status.state === "idle" || entry.status.state === "stopping") return

    entry.status = {
      ...entry.status,
      state: "stopping",
    }
    this.emit(entry.status)

    if (!entry.handle) return
    try {
      entry.handle.stop()
    } catch (error) {
      this.log(`Failed to stop run script for ${worktreeId}: ${message(error)}`)
    }
  }

  finish(worktreeId: string, opts: FinishOptions = {}): void {
    if (this.removed.has(worktreeId)) return
    const entry = this.entries.get(worktreeId)
    entry?.handle?.dispose?.()

    const status: RunStatus = {
      worktreeId,
      state: "idle",
      finishedAt: this.now().toISOString(),
    }
    if (entry?.status.startedAt) status.startedAt = entry.status.startedAt
    if (opts.exitCode !== undefined) status.exitCode = opts.exitCode
    if (opts.signal) status.signal = opts.signal
    if (opts.error) status.error = opts.error

    this.entries.set(worktreeId, { status })
    this.emit(status)
  }

  status(worktreeId: string): RunStatus {
    return this.entries.get(worktreeId)?.status ?? { worktreeId, state: "idle" }
  }

  all(): RunStatus[] {
    return [...this.entries.values()].map((entry) => entry.status)
  }

  remove(worktreeId: string): void {
    const entry = this.entries.get(worktreeId)
    if (entry?.status.state !== "idle") this.stop(worktreeId)
    this.entries.delete(worktreeId)
    this.removed.add(worktreeId)
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.status.state !== "idle") {
        try {
          entry.handle?.stop()
        } catch (error) {
          this.log(`Failed to stop run script during dispose: ${message(error)}`)
        }
      }
      entry.handle?.dispose?.()
    }
    this.entries.clear()
  }
}
