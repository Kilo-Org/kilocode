import type { ExportEvent } from "../events"

type Item = { sessionId: string; envelope: ExportEvent; bytes: number }

export class Inbox {
  private readonly capacity: number
  private items: Item[] = []
  private bytes = 0
  private degraded = new Set<string>()

  constructor(opts: { capacityBytes: number }) {
    this.capacity = opts.capacityBytes
  }

  enqueue(
    sessionId: string,
    approxPayloadSize: string | number,
    envelope: ExportEvent,
  ): { accepted: boolean; sessionFirstOverflow: boolean } {
    const bytes = typeof approxPayloadSize === "number" ? approxPayloadSize : approxPayloadSize.length
    if (this.bytes + bytes > this.capacity) {
      const first = !this.degraded.has(sessionId)
      this.degraded.add(sessionId)
      return { accepted: false, sessionFirstOverflow: first }
    }
    this.items.push({ sessionId, envelope, bytes })
    this.bytes += bytes
    return { accepted: true, sessionFirstOverflow: false }
  }

  drainBatch(limit: number): Item[] {
    const out = this.items.splice(0, limit)
    for (const item of out) this.bytes -= item.bytes
    return out
  }

  usedBytes(): number {
    return this.bytes
  }

  isDegraded(sessionId: string): boolean {
    return this.degraded.has(sessionId)
  }
}
