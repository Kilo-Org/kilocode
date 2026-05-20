/**
 * channel.ts — Async queue + concurrent work pool
 * Zero deps.
 *
 * const ch = new Channel<number>()
 * ch.push(1)
 * const v = await ch.next()
 */
export class Channel<T> implements AsyncIterable<T> {
  private buf: T[] = []
  private waiters: ((v: T) => void)[] = []

  push(item: T) {
    const w = this.waiters.shift()
    if (w) w(item); else this.buf.push(item)
  }

  async next(): Promise<T> {
    if (this.buf.length > 0) return this.buf.shift()!
    return new Promise((r) => this.waiters.push(r))
  }

  async *[Symbol.asyncIterator]() { while (true) yield await this.next() }
}

export async function pool<T>(n: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  await Promise.all(Array.from({ length: n }, async () => {
    while (true) { const item = pending.pop(); if (item === undefined) return; await fn(item) }
  }))
}
