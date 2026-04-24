import { Log } from "@/util/log"
import { pick } from "./platform/select"
import type { Inhibitor } from "./platform/types"

/**
 * Process-wide sleep inhibitor.
 *
 * Port of codex's public API in `codex-rs/utils/sleep-inhibitor/src/lib.rs`,
 * extended with multi-session refcounting because Kilo runs N concurrent
 * turns (Agent Manager panels, parallel sessions) while codex's TUI has one.
 *
 * Codex instantiates a `SleepInhibitor` per `ChatWidget`
 * (`codex-rs/tui/src/chatwidget.rs:5152`). We instead maintain a single
 * process-wide instance with a busy-session set: acquire on first busy
 * session (0 -> 1 transition), release on last idle (n -> 0). Behavior on
 * any individual session is identical to codex.
 *
 * Mapping to codex `lib.rs:28-72`:
 *
 *   codex                              |  kilo
 *   -----------------------------------+-------------------------------------
 *   SleepInhibitor::new(enabled)       |  configure({ enabled })
 *   set_turn_running(true)             |  acquire(sessionID)
 *   set_turn_running(false)            |  release(sessionID)
 *   is_turn_running()                  |  active() / busy()
 *   acquire() (private)                |  platform.acquire()  (via refcount)
 *   release() (private)                |  platform.release()  (via refcount)
 *
 * Disabled flag semantics match codex `lib.rs:48-51`: when disabled, any
 * acquire is a no-op and any live platform assertion is released, while the
 * busy-session set is still tracked so re-enabling mid-turn re-acquires.
 */

const log = Log.create({ service: "sleep-inhibitor" })

let enabled = false
let platform: Inhibitor | undefined
const busy = new Set<string>()

function ensure(): Inhibitor {
  if (!platform) platform = pick()
  return platform
}

function engaged(): boolean {
  return enabled && busy.size > 0
}

/**
 * Current platform claim state. Kept in step with `engaged()` transitions so
 * we only call `platform.acquire()` / `platform.release()` on edges.
 */
let claimed = false

function sync() {
  const want = engaged()
  if (want === claimed) return
  if (want) ensure().acquire()
  else ensure().release()
  claimed = want
}

export namespace SleepInhibitor {
  /**
   * Configure the inhibitor. Typically called once at startup from
   * `subscribe.ts` after reading `Config.prevent_idle_sleep`, and again
   * on config reload (matches codex `chatwidget.rs:9747-9749`).
   *
   * Mutates in place rather than constructing a new instance, so
   * busy-session state is preserved across config reloads.
   */
  export function configure(input: { enabled: boolean }) {
    const next = !!input.enabled
    if (next === enabled) return
    enabled = next
    log.info("configured", { enabled, busy: busy.size })
    sync()
  }

  /**
   * Mark a session's turn as started.
   *
   * Codex equivalent: `SleepInhibitor::set_turn_running(true)` called from
   * `codex-rs/tui/src/chatwidget.rs:2483-2484`.
   *
   * Idempotent per session — repeated calls with the same sessionID do not
   * affect platform state once the session is already tracked.
   */
  export function acquire(sessionID: string) {
    const already = busy.has(sessionID)
    busy.add(sessionID)
    if (!already) log.debug("acquire", { sessionID, count: busy.size })
    sync()
  }

  /**
   * Mark a session's turn as ended.
   *
   * Codex equivalent: `SleepInhibitor::set_turn_running(false)` called from
   * `codex-rs/tui/src/chatwidget.rs:2578-2579, 2996-2997`.
   *
   * Safe to call for a sessionID that was never acquired — the set delete
   * is a no-op. Releases the platform inhibitor when the last busy session
   * ends.
   */
  export function release(sessionID: string) {
    const had = busy.delete(sessionID)
    if (had) log.debug("release", { sessionID, count: busy.size })
    sync()
  }

  /**
   * Forcibly release the platform inhibitor and clear all tracked sessions.
   * Used on process shutdown so Linux subprocess backends don't outlive us
   * (see deviations in `./platform/linux.ts`).
   */
  export function drain() {
    busy.clear()
    sync()
  }

  /** Whether the platform inhibitor is currently engaged. Test helper. */
  export function active(): boolean {
    return claimed
  }

  /** Number of sessions currently marked busy. Test helper. */
  export function busyCount(): number {
    return busy.size
  }

  /** Test-only: swap the platform implementation and reset state. */
  export function __setPlatformForTests(impl: Inhibitor | undefined) {
    // Release the CURRENT platform only if it exists and is engaged. We must
    // NOT call `ensure()` here because that would lazily instantiate a real
    // platform inhibitor when `platform` is undefined (the case in tests
    // between `afterEach` and the next `beforeEach`), which would then run
    // real FFI/subprocess calls against the host OS.
    if (claimed && platform) platform.release()
    platform = impl
    claimed = false
    enabled = false
    busy.clear()
  }
}
