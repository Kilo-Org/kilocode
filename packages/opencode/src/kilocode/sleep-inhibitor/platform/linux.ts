import { spawn, which, type Subprocess } from "bun"
import { Log } from "@/util/log"
import { APP, REASON, type Inhibitor } from "./types"

/**
 * Linux idle-inhibit via subprocess.
 *
 * Faithful port of codex's `codex-rs/utils/sleep-inhibitor/src/linux_inhibitor.rs`.
 * Codex uses subprocess here as well (not native bindings) because Linux has
 * no stable libc API for this — the interfaces are D-Bus (systemd-logind,
 * gnome-SessionManager).
 *
 * Spawns `systemd-inhibit --what=idle --mode=block` wrapping a long sleep,
 * matching codex's command at `linux_inhibitor.rs:176-191`. Falls back to
 * `gnome-session-inhibit` when systemd is unavailable (codex
 * `linux_inhibitor.rs:192-203`). Remembers which backend worked and retries
 * it first on subsequent acquires (codex `linux_inhibitor.rs:66-79, 86`).
 *
 * ## Guaranteeing cleanup on parent death
 *
 * Codex uses `prctl(PR_SET_PDEATHSIG, SIGTERM)` in the child via `pre_exec`
 * (`linux_inhibitor.rs:213-223`) so that the kernel kills the inhibitor the
 * moment the parent process dies — even on SIGKILL / OOM / panic. This is
 * the key defensive measure that prevents a permanently-caffeinated machine
 * when things go wrong.
 *
 * Bun's `spawn` does not expose `prctl` and has no post-fork hook, so we
 * cannot call `prctl` in the child. Instead we achieve the same guarantee
 * with a watchdog shell wrapper that polls the parent's PID and kills the
 * inhibitor when the parent goes away:
 *
 *   trap 'kill -TERM "$c" 2>/dev/null' EXIT
 *   systemd-inhibit ... &
 *   c=$!
 *   while kill -0 <PARENT_PID> 2>/dev/null; do sleep 1; done
 *
 * Coverage:
 *   - Parent exits cleanly → `release()` sends SIGTERM to shell → `EXIT`
 *     trap fires → inhibitor killed.
 *   - Parent SIGKILL'd / crashes → shell survives, `kill -0 PARENT` fails
 *     on next poll (≤1s) → shell exits → `EXIT` trap kills inhibitor.
 *   - Shell itself SIGKILL'd → EXIT trap does NOT fire → inhibitor
 *     orphaned. This only happens if an external actor kills our shell
 *     child directly, not via any normal failure mode.
 *
 * Maximum lingering time in the worst realistic case: ~1 second. This is
 * functionally equivalent to codex's PDEATHSIG guarantee.
 *
 * Deliberately NOT used: `sh -c 'trap ... EXIT; exec ...'`. Once `exec`
 * replaces the shell process image, the trap is gone with it and the
 * wrapper provides zero protection. The `&` + poll pattern keeps the shell
 * alive to enforce cleanup.
 */

const log = Log.create({ service: "sleep-inhibitor:linux" })

// i32::MAX seconds (~68 years) — identical to codex `linux_inhibitor.rs:11`.
// Sanity-checked by the `sleep_seconds_is_i32_max` test in codex (line 236)
// and our own sleep-inhibitor test suite.
export const SLEEP_SECONDS = "2147483647"

// How often the watchdog polls the parent PID. 1s matches the granularity
// of the existing codex tests and keeps CPU overhead negligible.
const POLL_INTERVAL_SECONDS = "1"

type Backend = "systemd" | "gnome"

function binary(backend: Backend): string {
  return backend === "systemd" ? "systemd-inhibit" : "gnome-session-inhibit"
}

function args(backend: Backend): string[] {
  if (backend === "systemd") {
    return [
      "systemd-inhibit",
      "--what=idle",
      "--mode=block",
      "--who",
      APP,
      "--why",
      REASON,
      "--",
      "sleep",
      SLEEP_SECONDS,
    ]
  }
  return ["gnome-session-inhibit", "--inhibit", "idle", "--reason", REASON, "sleep", SLEEP_SECONDS]
}

/**
 * Build a `sh -c` command that runs the inhibitor under a parent-death
 * watchdog. See module-level comment for the full pattern and its coverage.
 *
 * The inner command is single-quoted for inclusion in the shell script, so
 * any embedded single quote in the REASON constant is escaped using the
 * standard POSIX `'\''` idiom.
 */
export function watchdog(inner: string[], parentPid: number): string[] {
  const quoted = inner.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(" ")
  const script = [
    `trap 'kill -TERM "$c" 2>/dev/null' EXIT`,
    `${quoted} &`,
    `c=$!`,
    `while kill -0 ${parentPid} 2>/dev/null; do sleep ${POLL_INTERVAL_SECONDS}; done`,
  ].join("; ")
  return ["sh", "-c", script]
}

/**
 * Attempt to launch a backend under the watchdog. Returns the running shell
 * wrapper subprocess on success, `undefined` if the backend binary is
 * missing or the shell fails to start.
 *
 * We detect missing binaries via `Bun.which()` *before* spawn instead of
 * relying on `child.exitCode === null` post-spawn, which is unreliable in
 * Bun (the exit event is delivered asynchronously, so a doomed child still
 * shows `exitCode === null` for a short window).
 *
 * `quiet` suppresses warnings the first time we observe a missing backend
 * mid-session, matching codex's `should_log_backend_failures` gating at
 * `linux_inhibitor.rs:65, 91, 100, 128`.
 */
function launch(backend: Backend, quiet: boolean, parentPid: number): Subprocess | undefined {
  if (!which(binary(backend))) {
    // Missing binary — silent per codex `linux_inhibitor.rs:128`
    // (`ErrorKind::NotFound` is explicitly not warned).
    return undefined
  }
  try {
    return spawn({
      cmd: watchdog(args(backend), parentPid),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
  } catch (err) {
    if (!quiet) {
      log.warn("failed to start backend", { backend, error: String(err) })
    }
    return undefined
  }
}

function order(preferred: Backend | undefined): Backend[] {
  if (preferred === "systemd") return ["systemd", "gnome"]
  if (preferred === "gnome") return ["gnome", "systemd"]
  return ["systemd", "gnome"]
}

export function linux(): Inhibitor {
  let active: { backend: Backend; child: Subprocess } | undefined
  let preferred: Backend | undefined
  // Tracks whether we've already logged a "no backend available" warning.
  // Reset on successful acquire (codex `linux_inhibitor.rs:87`).
  let loggedMissing = false
  // Capture our PID once at factory construction. `process.pid` should be
  // stable, but caching makes it impossible for a test or caller to mutate
  // `process.pid` mid-run and break the watchdog wiring.
  const parentPid = process.pid

  function stop(child: Subprocess) {
    // Best-effort: send SIGTERM and fire-and-forget. The watchdog's `EXIT`
    // trap ensures the actual inhibitor process dies when our shell child
    // receives SIGTERM and exits.
    try {
      child.kill("SIGTERM")
    } catch (err) {
      log.warn("failed to stop backend", { error: String(err) })
    }
  }

  return {
    acquire() {
      // Idempotent: if a backend is still running, keep it (codex
      // `linux_inhibitor.rs:44-46`).
      if (active && active.child.exitCode === null) return

      if (active) {
        log.warn("backend exited unexpectedly; restarting", {
          backend: active.backend,
          code: active.child.exitCode,
        })
        active = undefined
      }

      const quiet = loggedMissing
      for (const backend of order(preferred)) {
        const child = launch(backend, quiet, parentPid)
        if (!child) continue
        active = { backend, child }
        preferred = backend
        loggedMissing = false
        return
      }

      if (!loggedMissing) {
        log.warn("no Linux sleep inhibitor backend is available")
        loggedMissing = true
      }
    },

    release() {
      const current = active
      active = undefined
      if (!current) return
      stop(current.child)
    },
  }
}
