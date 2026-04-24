import type { Inhibitor } from "./types"

/**
 * No-op inhibitor.
 *
 * Port of codex's dummy backend — `codex-rs/utils/sleep-inhibitor/src/dummy.rs`
 * (used when target_os matches none of linux/macos/windows, selected via
 * `lib.rs:10-11, 19-20`).
 *
 * Also used as the safety fallback when a platform-specific implementation
 * fails to load (e.g. IOKit/PowrProf dlopen failure, all Linux backends missing).
 */
export function noop(): Inhibitor {
  return {
    acquire() {},
    release() {},
  }
}
