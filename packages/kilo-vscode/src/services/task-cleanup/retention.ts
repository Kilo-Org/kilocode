import { KiloRetentionRpc } from "@opencode/schema/kilocode/retention"
import type { AgentManagerConnection } from "../../agent-manager/connection"

const DAY_MS = 86_400_000
// The first pass goes out shortly after the server connects, so a user who does not keep a window open for a day still
// gets one. The server's spacing between passes makes these early triggers harmless.
const FIRST_TICK_MS = 2 * 60_000

type Connection = Pick<AgentManagerConnection, "client" | "onEvent" | "onState" | "state">

/**
 * The daily trigger of session retention. The server decides everything: whether retention is enabled, the spacing
 * between passes, which sessions are expired and which are busy. This only asks for a pass once a day, and only while
 * the server reports the policy as enabled, so a disabled policy arms no timer at all.
 */
export class RetentionService {
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly unsubscribe: (() => void)[]
  private disposed = false

  constructor(
    private readonly connection: Connection,
    private readonly directory: () => string,
    private readonly log: (message: string) => void,
    private readonly delays = { first: FIRST_TICK_MS, day: DAY_MS },
  ) {
    this.unsubscribe = [
      connection.onState((state) => {
        if (state === "connected") return void this.refresh()
        this.disarm()
      }),
      // A config write can turn retention on or off.
      connection.onEvent((event) => {
        if (event.type === "config.updated") void this.refresh()
      }),
    ]
    if (connection.state() === "connected") void this.refresh()
  }

  /** Whether a pass is scheduled. */
  get armed() {
    return this.timer !== undefined
  }

  /** Arms the trigger when the policy is enabled and disarms it otherwise. */
  async refresh(): Promise<void> {
    const status = await this.rpc()
      .then((rpc) => rpc.status({}, { location: { directory: this.directory() } }))
      .catch((error: unknown) => {
        this.log(`Session retention status failed: ${String(error)}`)
        return undefined
      })
    if (this.disposed || status === undefined) return
    if (!status.policy.enabled) return this.disarm()
    if (!this.timer) this.schedule(this.delays.first)
  }

  dispose(): void {
    this.disposed = true
    this.disarm()
    this.unsubscribe.forEach((unsubscribe) => unsubscribe())
  }

  private rpc() {
    return this.connection.client().then((client) => client.rpc(KiloRetentionRpc.Definition))
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private disarm(): void {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private async tick(): Promise<void> {
    this.timer = undefined
    if (this.disposed || this.connection.state() !== "connected") return
    const status = await this.rpc()
      .then((rpc) => rpc.run({}, { location: { directory: this.directory() } }))
      .catch((error: unknown) => {
        this.log(`Scheduled session retention failed: ${String(error)}`)
        return undefined
      })
    if (this.disposed || this.timer) return
    // A pass that reports the policy as disabled stops the trigger until a config change enables it again.
    if (status && !status.policy.enabled) return
    this.schedule(this.delays.day)
  }
}
