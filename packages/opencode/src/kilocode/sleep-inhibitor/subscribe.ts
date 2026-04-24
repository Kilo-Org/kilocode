import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Log } from "@/util/log"
import { Session } from "@/session"
import { SleepInhibitor } from "."

/**
 * Wire the sleep inhibitor into Kilo's session lifecycle.
 *
 * Subscribes to the bus events published from
 * `packages/opencode/src/session/prompt.ts:1596` (`Session.Event.TurnOpen`,
 * emitted inside `SessionPrompt.loop` at turn start) and `:1600`
 * (`Session.Event.TurnClose`, emitted inside `Effect.onExit` so it fires on
 * success, error, and cancellation).
 *
 * Subscription pattern matches
 * `packages/opencode/src/kilo-sessions/kilo-sessions.ts:243-247`.
 *
 * **Ordering note**: subscriptions and shutdown handlers are registered
 * synchronously *before* awaiting config, so a TurnOpen that fires during the
 * init window is still captured. Until `configure()` runs the SleepInhibitor
 * has `enabled=false` and tracks busy sessions without engaging the platform;
 * once config loads, if any sessions are still busy the platform engages
 * retroactively.
 */

const log = Log.create({ service: "sleep-inhibitor:subscribe" })

let initialized = false

export async function init() {
  if (initialized) return
  initialized = true

  // Register subscriptions and shutdown handlers first — these are
  // synchronous and need to be live before any turn opens.
  Bus.subscribe(Session.Event.TurnOpen, (evt) => {
    SleepInhibitor.acquire(evt.properties.sessionID)
  })
  Bus.subscribe(Session.Event.TurnClose, (evt) => {
    SleepInhibitor.release(evt.properties.sessionID)
  })
  registerShutdown()

  // Load config after subscriptions are live. If config read fails, default
  // to enabled (codex's stable-feature default; users can opt out in
  // kilo.json).
  const cfg = await Config.get().catch((err) => {
    log.warn("failed to read config; defaulting to enabled", { error: String(err) })
    return undefined
  })
  const want = cfg?.prevent_idle_sleep ?? true
  SleepInhibitor.configure({ enabled: want })

  log.info("initialized", { enabled: want })
}

let shutdownRegistered = false

/**
 * Register every reasonable process-termination hook so the sleep inhibitor
 * is released no matter how we exit.
 *
 * Coverage:
 *   - `exit`                — normal process termination (Node runs handlers
 *                             synchronously; cleanup must be synchronous).
 *   - `beforeExit`          — natural exit when the event loop empties.
 *   - `SIGINT` / `SIGTERM`  — interactive and orchestrator-driven shutdown.
 *   - `uncaughtException`   — last-chance cleanup on a crash we didn't catch.
 *   - `unhandledRejection`  — last-chance cleanup on a promise that slipped
 *                             the error net.
 *
 * `SIGKILL` cannot be caught; for that case we rely on the platform-level
 * guarantees (macOS/Windows: kernel auto-releases; Linux: watchdog shell in
 * `platform/linux.ts` detects parent death and kills the inhibitor within
 * ~1 second).
 *
 * `uncaughtException` / `unhandledRejection` handlers call `drain()` but do
 * NOT call `process.exit()` — other modules (e.g. `cli/cmd/tui/thread.ts`)
 * also register handlers and decide process fate; we must not intercept.
 */
function registerShutdown() {
  if (shutdownRegistered) return
  shutdownRegistered = true

  const cleanup = () => {
    try {
      SleepInhibitor.drain()
    } catch (err) {
      log.warn("drain failed", { error: String(err) })
    }
  }

  process.on("exit", cleanup)
  process.on("beforeExit", cleanup)
  process.on("SIGINT", () => {
    cleanup()
    process.exit(130)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(143)
  })
  // For `uncaughtException` / `unhandledRejection` we drain without calling
  // `process.exit()`. Other modules may register their own handlers and
  // decide process fate (e.g. `src/cli/cmd/tui/thread.ts:179-180` logs and
  // continues). Our job is only to make sure the inhibitor is released in
  // the crashed-but-still-running window. If the process does terminate
  // later, our `exit` handler runs again — `drain()` is idempotent.
  process.on("uncaughtException", (err) => {
    log.warn("uncaughtException; draining inhibitor", { error: String(err) })
    cleanup()
  })
  process.on("unhandledRejection", (reason) => {
    log.warn("unhandledRejection; draining inhibitor", { error: String(reason) })
    cleanup()
  })
}
