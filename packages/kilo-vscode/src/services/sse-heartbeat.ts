export class SSEHeartbeat {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly timeout: number,
    private readonly callback: () => void,
  ) {}

  reset(): void {
    this.dispose()
    this.timer = setTimeout(() => {
      this.timer = null
      this.callback()
    }, this.timeout)
  }

  dispose(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
