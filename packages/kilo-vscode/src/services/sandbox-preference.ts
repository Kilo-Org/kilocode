import type * as vscode from "vscode"

export const SANDBOX_DEFAULT_KEY = "kilo-code.v2.sandbox.newSessionDefault"

type Store = Pick<vscode.Memento, "get" | "update">

/**
 * The user's sandbox choice for new sessions. The stored value is the whole intent: an unset value falls back to the
 * config default, and writes are serialized so two quick toggles apply in the order the user made them.
 */
export class SandboxPreference {
  private pending = Promise.resolve()

  constructor(private readonly state: Store) {}

  explicit(): boolean | undefined {
    return this.state.get<boolean>(SANDBOX_DEFAULT_KEY)
  }

  resolve(fallback: boolean): boolean {
    return this.explicit() ?? fallback
  }

  wait(): Promise<void> {
    return this.pending
  }

  set(enabled: boolean, validate?: () => Promise<void>): Promise<void> {
    const update = this.pending
      .catch(() => undefined)
      .then(async () => {
        await validate?.()
        await this.state.update(SANDBOX_DEFAULT_KEY, enabled)
      })
    this.pending = update
    void update
      .catch(() => undefined)
      .finally(() => {
        if (this.pending === update) this.pending = Promise.resolve()
      })
    return update
  }
}
