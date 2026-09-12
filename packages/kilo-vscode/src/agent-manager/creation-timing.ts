/** Structured timing for worktree creation flows. */

export type TimingLog = (...args: unknown[]) => void
export type TimingClock = () => number

export interface Span {
  label: string
  total: number
  phases: Record<string, number>
  line: string
}

/**
 * Lap timer for worktree creation. Call `mark(phase)` when a phase finishes to
 * record the elapsed time since the previous mark, or pass a `start` reading to
 * record a span that began earlier (used for overlapped work). `end()` writes
 * one line through the provided logger and returns the same numbers.
 */
export class Timing {
  static start(label: string, log?: TimingLog, clock: TimingClock = () => performance.now()): Timing {
    return new Timing(label, log, clock)
  }

  private readonly spans: Record<string, number> = {}
  private readonly order: string[] = []
  private readonly startAt: number
  private last: number

  private constructor(
    private readonly label: string,
    private readonly log: TimingLog | undefined,
    private readonly clock: TimingClock,
  ) {
    this.startAt = this.clock()
    this.last = this.startAt
  }

  /** Current reading of the timing clock, for spans that start before a mark. */
  now(): number {
    return this.clock()
  }

  mark(phase: string, start?: number): void {
    const at = this.clock()
    this.spans[phase] = (this.spans[phase] ?? 0) + (at - (start ?? this.last))
    this.order.push(phase)
    this.last = at
  }

  result(): Span {
    const total = Math.round(this.clock() - this.startAt)
    const phases: Record<string, number> = {}
    const parts: string[] = []
    for (const phase of this.order) {
      const value = Math.round(this.spans[phase]!)
      phases[phase] = value
      parts.push(`${phase}=${value}`)
    }
    const suffix = parts.length > 0 ? ` ${parts.join(" ")}` : ""
    return {
      label: this.label,
      total,
      phases,
      line: `[agent-manager] ${this.label} total=${total}ms${suffix}`,
    }
  }

  end(): Span {
    const span = this.result()
    this.log?.(span.line)
    return span
  }
}
