import { eligible, type UpsellAction, type UpsellState } from "../shared/agent-manager-upsell"
import type { UpsellPreferences } from "./upsell-preferences"

type Storage = {
  get<T>(key: string, fallback: T): T
  update(key: string, value: unknown): PromiseLike<void>
}

const KEY = "upsell.agentManager"

/** One instance belongs to the ordinary sidebar provider, not a webview mount. */
export class SidebarUpsell {
  private shown = false
  private granted = false
  private queue = Promise.resolve()

  constructor(
    private readonly prefs: Pick<UpsellPreferences, "read" | "update"> | undefined,
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
      await this.prefs?.update("observed", this.clock())
    })
  }

  handle(action: UpsellAction | "rendered" | undefined, visible: boolean) {
    return this.enqueue(async () => {
      const state: UpsellState = (await this.prefs?.read()) ?? { optedOut: true }
      const engaged = (this.workspace?.get<string[]>(`${KEY}.sessions`, []) ?? []).length >= 2
      if (!action) return { state, engaged, display: false }
      if (!visible) return { state, engaged, display: false }
      if (action === "rendered") {
        if (this.granted) this.shown = true
        return { state, engaged, display: false }
      }
      if (action === "shown") {
        const display = !this.shown && engaged && eligible(state, this.clock())
        if (display) this.granted = true
        return { state, engaged, display }
      }
      if (this.granted) this.shown = true
      const next = (await this.prefs?.update(action, this.clock())) ?? state
      return {
        state: next,
        engaged,
        display: action === "undo" && !!this.prefs && engaged && eligible(next, this.clock()),
      }
    })
  }
}
