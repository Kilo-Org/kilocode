/**
 * Runtime adapter interfaces for the indexing package.
 *
 * RATIONALE: Decouple the indexing engine from any host environment (VS Code, CLI, etc.)
 * by expressing all external capabilities as injectable contracts.
 */

/**
 * Minimal typed event emitter that replaces vscode.EventEmitter.
 * Consumers subscribe via `on()` and receive a dispose function.
 */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>()

  on(listener: (value: T) => void): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}

export interface Disposable {
  dispose(): void
}
