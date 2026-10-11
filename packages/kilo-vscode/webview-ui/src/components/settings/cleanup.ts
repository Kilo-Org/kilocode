import type { AutoCleanupStateLoadedMessage, WebviewMessage } from "../../types/messages"

/** One status request at a time, owned by the mounted Settings tab. */
export class CleanupPoll {
  private timer?: ReturnType<typeof setTimeout>
  private request?: string
  private run?: string
  private halt?: string
  private disposed = false
  private stale = false
  private failure?: AutoCleanupStateLoadedMessage["error"]
  private state?: AutoCleanupStateLoadedMessage

  constructor(
    private readonly post: (message: WebviewMessage) => void,
    private readonly update: (message: AutoCleanupStateLoadedMessage, pending: boolean) => void,
  ) {}

  start(): void {
    if (this.disposed || this.request) return
    clearTimeout(this.timer)
    this.request = crypto.randomUUID()
    this.post({ type: "requestAutoCleanupState", requestID: this.request })
  }

  execute(): void {
    if (this.disposed || this.run) return
    this.failure = undefined
    this.run = crypto.randomUUID()
    this.post({ type: "runAutoCleanupNow", requestID: this.run })
  }

  stop(): void {
    if (this.disposed || this.halt || !(this.run || this.state?.progress)) return
    this.halt = crypto.randomUUID()
    this.post({ type: "stopAutoCleanupNow", requestID: this.halt })
  }

  receive(message: AutoCleanupStateLoadedMessage): void {
    if (this.disposed || !message.requestID) return
    if (message.requestID === this.run) {
      this.run = undefined
      this.failure = message.error
      // Discard a status response captured before the run completed.
      this.stale = Boolean(this.request)
    } else if (message.requestID === this.request) {
      this.request = undefined
      if (this.stale) {
        this.stale = false
        this.start()
        return
      }
    } else if (message.requestID !== this.halt) return
    if (message.requestID === this.halt) this.halt = undefined
    // A pass that no longer reports progress cannot be stopped anymore.
    if (!message.progress) this.halt = undefined
    const unavailable = message.error === "status" || message.error === "timeout"
    this.state = {
      ...message,
      ...(unavailable ? { progress: this.state?.progress, pending: message.pending || this.state?.pending } : {}),
      error: message.error ?? this.failure,
    }
    this.update(this.state, Boolean(this.run || this.state.pending))
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.start(), 1000)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
  }
}
