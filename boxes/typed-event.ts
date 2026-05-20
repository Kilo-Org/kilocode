/**
 * typed-event.ts — Typed event emitter (pub/sub)
 * Inspired by superset EventBus + gemini-cli coreEvents
 * Deps: none
 */

type Listener<T = any> = (data: T) => void

export class TypedEventBus<Events extends Record<string, any> = Record<string, any>> {
  private listeners = new Map<keyof Events, Set<Listener>>()

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn)
    return () => this.off(event, fn)
  }

  once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    const wrapped: Listener<Events[K]> = (data) => {
      this.off(event, wrapped)
      fn(data)
    }
    return this.on(event, wrapped)
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(fn)
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const fn of set) fn(data)
  }

  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0
  }

  removeAll(event?: keyof Events): void {
    if (event) this.listeners.delete(event)
    else this.listeners.clear()
  }
}
