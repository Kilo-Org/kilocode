import type { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"

export type CleanupError = "status" | "timeout" | "run"

export interface CleanupState {
  readonly status?: KiloRetentionRpc.Status
  /** A manual run from this tab is in flight. */
  readonly running: boolean
  readonly error?: CleanupError
}

export interface CleanupRpc {
  status(input: Record<string, never>, options: { signal: AbortSignal }): Promise<KiloRetentionRpc.Status>
  run(input: { force: true }): Promise<KiloRetentionRpc.Status>
  cancel(input: Record<string, never>): Promise<{ requested: boolean }>
}

const POLL_MS = 1000
const STATUS_TIMEOUT_MS = 10_000

/**
 * The session cleanup state of the Settings tab: one status request at a time, repeated a second after each reply
 * while the tab is mounted, so a pass the extension host or another client started shows its progress too. A manual run
 * forces a pass past the server's spacing, never past its enable check.
 */
export class CleanupPoll {
  private timer: ReturnType<typeof setTimeout> | undefined
  private request: AbortController | undefined
  private disposed = false
  private state: CleanupState = { running: false }

  constructor(
    private readonly rpc: CleanupRpc,
    private readonly update: (state: CleanupState) => void,
    private readonly timing = { poll: POLL_MS, timeout: STATUS_TIMEOUT_MS },
  ) {}

  get current() {
    return this.state
  }

  start(): void {
    if (this.disposed || this.request) return
    clearTimeout(this.timer)
    const request = new AbortController()
    this.request = request
    const timeout = setTimeout(() => request.abort(), this.timing.timeout)
    void this.rpc
      .status({}, { signal: request.signal })
      .then(
        (status) => this.set({ status, error: this.state.error === "run" ? "run" : undefined }),
        () => this.set({ error: request.signal.aborted ? "timeout" : "status" }),
      )
      .finally(() => {
        clearTimeout(timeout)
        if (this.request === request) this.request = undefined
        if (!this.disposed) this.timer = setTimeout(() => this.start(), this.timing.poll)
      })
  }

  execute(): void {
    if (this.disposed || this.state.running) return
    this.set({ running: true, error: undefined })
    void this.rpc.run({ force: true }).then(
      (status) => this.set({ status, running: false }),
      () => this.set({ running: false, error: "run" }),
    )
  }

  stop(): void {
    if (this.disposed || !this.state.status?.progress) return
    void this.rpc.cancel({}).then(
      () => this.refresh(),
      () => this.set({ error: "run" }),
    )
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.request?.abort()
  }

  /** Read the status now instead of at the next poll. */
  private refresh(): void {
    if (this.request) return
    this.start()
  }

  private set(next: Partial<CleanupState>): void {
    if (this.disposed) return
    this.state = { ...this.state, ...next }
    this.update(this.state)
  }
}
