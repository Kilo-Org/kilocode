export class Preparations {
  private readonly buckets = new Map<string, Set<AbortController>>()

  track(sid: string): AbortController {
    const controller = new AbortController()
    const bucket = this.buckets.get(sid)
    if (bucket) {
      bucket.add(controller)
      return controller
    }
    this.buckets.set(sid, new Set([controller]))
    return controller
  }

  finish(sid: string, controller: AbortController): void {
    const bucket = this.buckets.get(sid)
    if (!bucket) return
    bucket.delete(controller)
    if (bucket.size === 0) this.buckets.delete(sid)
  }

  cancel(sid: string): void {
    const bucket = this.buckets.get(sid)
    if (!bucket) return
    this.abort(bucket)
  }

  dispose(): void {
    const pending = [...this.buckets.values()]
    this.buckets.clear()
    for (const bucket of pending) this.abort(bucket)
  }

  private abort(bucket: Set<AbortController>): void {
    for (const controller of [...bucket]) controller.abort()
  }
}
