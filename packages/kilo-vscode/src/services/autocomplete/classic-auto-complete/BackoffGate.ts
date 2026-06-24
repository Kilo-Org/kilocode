import type { KiloConnectionService } from "../../cli-backend"
import { ErrorBackoff } from "./ErrorBackoff"

/**
 * Shared request gate for autocomplete providers.
 *
 * Wraps {@link ErrorBackoff} with the pause/notify/recover orchestration that
 * both the classic FIM provider and the next-edit provider need:
 * - blocks requests once errors start (so a single keystroke can't re-pop the
 *   "autocomplete paused" toast on every character),
 * - fires the fatal-error notification at most once per episode,
 * - self-heals from a 402 by periodically probing the credit balance, and
 * - resets on a successful response or an explicit auth/connection change.
 *
 * Keeping this in one place stops the two providers from drifting apart — the
 * exact divergence that caused next-edit to spam the paused notification.
 */
export class BackoffGate {
  private readonly backoff = new ErrorBackoff()
  private fatalNotified = false

  constructor(
    private readonly connection: KiloConnectionService,
    private readonly onFatal?: (status: number | null) => void,
  ) {}

  /**
   * Whether a request may proceed right now. When blocked on a 402, periodically
   * probes the balance endpoint and resumes if the user has topped up.
   */
  async allow(): Promise<boolean> {
    if (!this.backoff.blocked()) return true
    if (this.backoff.getFatalStatus() === 402 && this.backoff.shouldProbe() && (await this.hasBalance())) {
      this.reset()
    }
    return !this.backoff.blocked()
  }

  /** Record a successful response and re-arm the fatal notification. */
  success(): void {
    this.backoff.success()
    this.fatalNotified = false
  }

  /** Record an error, firing the fatal notification at most once per episode. */
  failure(err: unknown): void {
    const kind = this.backoff.failure(err)
    if (kind === "fatal" && !this.fatalNotified) {
      this.fatalNotified = true
      this.onFatal?.(this.backoff.getFatalStatus())
    }
  }

  /** Clear all state (e.g. on login, reconnect, or org switch). */
  reset(): void {
    this.backoff.reset()
    this.fatalNotified = false
  }

  /**
   * Positive credit balance check via the profile endpoint. Returns false on any
   * error (not connected, fetch failed) so a probe failure keeps the gate closed.
   */
  private async hasBalance(): Promise<boolean> {
    const client = await this.connection.getClientAsync().catch(() => null)
    if (!client) return false
    const result = await client.kilo.profile().catch(() => null)
    return (result?.data?.balance?.balance ?? 0) > 0
  }
}
