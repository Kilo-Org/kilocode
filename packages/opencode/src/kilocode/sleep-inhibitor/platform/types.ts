/**
 * Shared interface for platform-specific sleep inhibitors.
 *
 * Mirrors codex's trait-like `imp::SleepInhibitor` used via `cfg`-gated
 * module selection in `codex-rs/utils/sleep-inhibitor/src/lib.rs:10-26`.
 *
 * Implementations must:
 * - Make `acquire()` idempotent (codex `macos.rs:39-41`, `windows_inhibitor.rs:32-34`,
 *   `linux_inhibitor.rs:44-62`). A second call while already held is a no-op.
 * - Make `release()` idempotent. Safe to call when not held.
 * - Never throw. Log warnings on failure and degrade to no-op. Matches codex's
 *   `warn!` + continue pattern (`macos.rs:46-52`, `windows_inhibitor.rs:40-45`).
 */
export interface Inhibitor {
  /** Engage the OS-level idle-sleep prevention. Idempotent. */
  acquire(): void
  /** Release the OS-level idle-sleep prevention. Idempotent. */
  release(): void
}

/** Human-readable reason string attached to OS assertions (where supported). */
export const REASON = "Kilo is running an active turn"

/** Identifier used in Linux inhibitor backends (`--who` flag). */
export const APP = "kilo"
