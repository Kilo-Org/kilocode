export class RequestGate<T = void> {
  private readonly requests = new Map<string, Promise<T>>()

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const current = this.requests.get(key)
    if (current) return current

    const promise = fn().finally(() => {
      if (this.requests.get(key) === promise) this.requests.delete(key)
    })
    this.requests.set(key, promise)
    return promise
  }

  get(key: string): Promise<T> | undefined {
    return this.requests.get(key)
  }

  clear(): void {
    this.requests.clear()
  }
}
