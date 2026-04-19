/**
 * Leader chain state machine.
 *
 * Mirrors the behavior of the existing Ctrl+X leader FSM in:
 *   packages/opencode/src/cli/cmd/tui/context/keybind.tsx (lines 24–67)
 *
 * Key behaviors:
 * - Default timeout: 2000ms (matching existing TUI)
 * - Flat chains only: no nested leader-within-leader
 * - Uses setTimeout/clearTimeout — works in both Node/Bun and browser
 *
 * INERT IN PHASE 3: This module is exported so Plan 03-02/03-03 can import it,
 * but NO code in Phase 3 calls `activate()`. The existing Ctrl+X FSM in
 * keybind.tsx remains the live handler. Phase 5 wires `createLeaderChain` into
 * the new `useKeyboard` and removes the old FSM to prevent double-handler collisions.
 */

/** Options for the leader chain state machine. */
export interface LeaderChainOptions {
  /** Milliseconds before the leader chain automatically resets. Default: 2000. */
  timeoutMs?: number
}

/** The leader chain state machine interface. */
export interface LeaderChain {
  /**
   * Activate the leader chain. Starts the inactivity timer.
   * Calling activate() while already active resets and restarts the timer.
   */
  activate(): void
  /**
   * Handle a key press.
   * - While active: consumes the key, resets the chain, returns "chained".
   * - While inactive: returns "reset" (key should be processed normally).
   */
  press(key: string): "chained" | "reset"
  /** Returns true if the leader chain is currently active. */
  isActive(): boolean
  /** Immediately deactivate the leader chain without processing a key. */
  cancel(): void
}

/**
 * Create a new leader chain state machine.
 *
 * @param options.timeoutMs - Inactivity timeout in ms before chain auto-resets. Default: 2000.
 * @returns A `LeaderChain` instance.
 *
 * @example
 * ```ts
 * const chain = createLeaderChain({ timeoutMs: 2000 })
 * chain.activate()               // start the chain (e.g. user pressed Ctrl+X)
 * chain.press("p")               // → "chained" (the "p" was consumed by the leader)
 * chain.isActive()               // → false (auto-reset after press)
 * ```
 */
export function createLeaderChain(options: LeaderChainOptions = {}): LeaderChain {
  const timeoutMs = options.timeoutMs ?? 2000

  let active = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function reset() {
    active = false
    clearTimer()
  }

  return {
    activate() {
      clearTimer()
      active = true
      timer = setTimeout(() => {
        reset()
      }, timeoutMs)
    },

    press(key: string): "chained" | "reset" {
      if (!active) return "reset"
      // Suppress the unused parameter warning — the key is intentionally
      // consumed (callers use the return value to decide whether to forward it).
      void key
      reset()
      return "chained"
    },

    isActive(): boolean {
      return active
    },

    cancel() {
      reset()
    },
  }
}
