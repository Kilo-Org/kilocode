import {
  CaffeinationController,
  createCaffeinationDriver,
  type CaffeinationDriver,
  type CaffeinationState,
} from "@kilocode/caffeination"
import type { AgentManagerConnection } from "../../agent-manager/connection"
import { feed } from "./feed"

export type { CaffeinationState } from "@kilocode/caffeination"

type Listener = (state: CaffeinationState) => void

export class CaffeinationService {
  private readonly projection: ReturnType<typeof feed>
  private readonly controller: CaffeinationController
  private readonly listeners = new Set<Listener>()
  private readonly unsubscribe: (() => void)[]
  private busy = false
  private disposed = false
  private closing: Promise<void> | undefined

  constructor(
    private readonly connection: Pick<AgentManagerConnection, "client" | "onEvent" | "onState" | "state">,
    private readonly paths: () => string[],
    driver: CaffeinationDriver = createCaffeinationDriver(),
  ) {
    this.controller = new CaffeinationController({ driver })
    this.controller.onChange((state) => {
      for (const listener of this.listeners) listener(state)
    })
    this.projection = feed({
      paths: this.paths,
      watching: () => this.watching(),
      load: async (dir) => {
        const client = await connection.client()
        const [sessions, active] = await Promise.all([
          client.session.list({ directory: dir, parentID: null }),
          client.session.active(),
        ])
        const ids = new Set((sessions.data ?? []).map((session) => session.id))
        return new Set(Object.keys(active).filter((id) => ids.has(id)))
      },
      post: (busy) => {
        if (this.busy === busy) return
        this.busy = busy
        void this.controller.setBusy(busy)
      },
    })
    this.unsubscribe = [
      connection.onEvent((event) => this.projection.event({ type: event.type, location: event.location, data: event.data })),
      connection.onState((state) => {
        if (state === "connected") {
          void this.refresh()
          return
        }
        this.projection.clear()
        void this.controller.setBusy(false)
      }),
    ]
  }

  getState(): CaffeinationState {
    return this.controller.getState()
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return this.closing ?? Promise.resolve()
    if (!enabled) this.projection.clear()
    await this.controller.setEnabled(enabled)
    if (enabled) await this.refresh()
  }

  async refresh(): Promise<void> {
    if (!this.watching()) return
    await this.projection.sync()
    await this.controller.setBusy(this.busy)
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    for (const unsubscribe of this.unsubscribe) unsubscribe()
    this.projection.dispose()
    this.listeners.clear()
    this.closing = this.controller.dispose()
    return this.closing
  }

  private watching(): boolean {
    const state = this.controller.getState()
    return !this.disposed && state.enabled && state.available && this.connection.state() === "connected"
  }
}
