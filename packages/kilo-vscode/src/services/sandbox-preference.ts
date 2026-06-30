import type * as vscode from "vscode"

const KEY = "kilo.sandbox.newSessionDefault"

type Listener = (enabled: boolean, revision: number) => void

type Store = Pick<vscode.Memento, "get" | "update">

export class SandboxPreference {
  private value: boolean | undefined
  private revision = 0
  private pending = Promise.resolve()
  private readonly listeners = new Set<Listener>()

  constructor(private readonly state: Store) {
    this.value = state.get<boolean>(KEY)
  }

  explicit(): boolean | undefined {
    return this.value
  }

  resolve(fallback: boolean): boolean {
    return this.value ?? fallback
  }

  getRevision(): number {
    return this.revision
  }

  wait(): Promise<void> {
    return this.pending
  }

  set(enabled: boolean, validate?: () => Promise<void>): Promise<void> {
    const update = this.pending
      .catch(() => undefined)
      .then(async () => {
        await validate?.()
        await this.state.update(KEY, enabled)
        this.value = enabled
        this.revision += 1
        for (const listener of this.listeners) listener(enabled, this.revision)
      })
    this.pending = update
    void update
      .catch(() => undefined)
      .finally(() => {
        if (this.pending === update) this.pending = Promise.resolve()
      })
    return update
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
