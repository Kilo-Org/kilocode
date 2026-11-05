import { eligible, type UpsellAction, type UpsellState } from "../shared/agent-manager-upsell"

type Storage = {
  get<T>(key: string, fallback: T): T
  update(key: string, value: unknown): PromiseLike<void>
}

const KEY = "upsell.agentManager"

/** One instance belongs to the ordinary sidebar provider, not a webview mount. */
export class SidebarUpsell {
  private shown = false
  private queue = Promise.resolve()

  constructor(
    private readonly global: Storage | undefined,
    private readonly workspace: Storage | undefined,
    private readonly clock = Date.now,
  ) {}

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run)
    this.queue = result.then(
      () => {},
      (err) => console.error("[Kilo New] Sidebar upsell persistence failed:", err),
    )
    return result
  }

  started(id: string) {
    return this.enqueue(async () => {
      const ids = this.workspace?.get<string[]>(`${KEY}.sessions`, []) ?? []
      if (ids.length >= 2 || ids.includes(id)) return
      await this.workspace?.update(`${KEY}.sessions`, [...ids, id])
    })
  }

  opened() {
    return this.enqueue(async () => {
      await this.global?.update(KEY, { ...this.global.get<UpsellState>(KEY, {}), opened: true })
    })
  }

  handle(action: UpsellAction | undefined, visible: boolean) {
    return this.enqueue(async () => {
      const state = this.global?.get<UpsellState>(KEY, {}) ?? { optedOut: true }
      const engaged = (this.workspace?.get<string[]>(`${KEY}.sessions`, []) ?? []).length >= 2
      if (!action) return { state, engaged, display: false }
      if (!visible) return { state, engaged, display: false }
      if (action === "shown") {
        const display = !this.shown && engaged && eligible(state, this.clock())
        if (display) this.shown = true
        return { state, engaged, display }
      }
      const next: UpsellState = {
        ...state,
        ...(action === "opened" ? { converted: true } : {}),
        ...(action === "not_now"
          ? { snoozedAt: this.clock(), snoozeCount: Math.min(3, (state.snoozeCount ?? 0) + 1) }
          : {}),
        ...(action === "dont_show_again" ? { optedOut: true } : {}),
        ...(action === "undo" ? { optedOut: false } : {}),
      }
      await this.global?.update(KEY, next)
      return {
        state: next,
        engaged,
        display: action === "undo" && !!this.global && engaged && eligible(next, this.clock()),
      }
    })
  }
}
