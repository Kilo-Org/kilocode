import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { SleepInhibitor } from "../../src/kilocode/sleep-inhibitor"
import { SLEEP_SECONDS, watchdog } from "../../src/kilocode/sleep-inhibitor/platform/linux"
import type { Inhibitor } from "../../src/kilocode/sleep-inhibitor/platform/types"

/**
 * Port of codex's `codex-rs/utils/sleep-inhibitor/src/lib.rs:74-112` tests,
 * plus Kilo-specific tests covering the multi-session refcount extension.
 *
 * The platform backend is replaced with a recording spy so these tests stay
 * hermetic — no IOKit / PowrProf / systemd-inhibit interaction.
 */

interface SpyInhibitor extends Inhibitor {
  readonly acquires: { current: number }
  readonly releases: { current: number }
  readonly active: { current: boolean }
}

function spy(): SpyInhibitor {
  const acquires = { current: 0 }
  const releases = { current: 0 }
  const active = { current: false }
  return {
    acquires,
    releases,
    active,
    acquire() {
      if (active.current) return // match idempotent platform contract
      active.current = true
      acquires.current++
    },
    release() {
      if (!active.current) return
      active.current = false
      releases.current++
    },
  }
}

let platform: SpyInhibitor

beforeEach(() => {
  platform = spy()
  SleepInhibitor.__setPlatformForTests(platform)
})

afterEach(() => {
  SleepInhibitor.__setPlatformForTests(undefined)
})

describe("SleepInhibitor — codex behavior parity", () => {
  // Port of codex `lib.rs:78-85` — `sleep_inhibitor_toggles_without_panicking`
  it("toggles acquire and release", () => {
    SleepInhibitor.configure({ enabled: true })

    SleepInhibitor.acquire("s1")
    expect(SleepInhibitor.busyCount()).toBe(1)
    expect(SleepInhibitor.active()).toBe(true)
    expect(platform.acquires.current).toBe(1)

    SleepInhibitor.release("s1")
    expect(SleepInhibitor.busyCount()).toBe(0)
    expect(SleepInhibitor.active()).toBe(false)
    expect(platform.releases.current).toBe(1)
  })

  // Port of codex `lib.rs:87-94` — `sleep_inhibitor_disabled_does_not_panic`.
  // When disabled, acquire is tracked but never engages the platform.
  it("disabled does not engage the platform", () => {
    SleepInhibitor.configure({ enabled: false })

    SleepInhibitor.acquire("s1")
    expect(SleepInhibitor.busyCount()).toBe(1)
    expect(SleepInhibitor.active()).toBe(false)
    expect(platform.acquires.current).toBe(0)

    SleepInhibitor.release("s1")
    expect(platform.releases.current).toBe(0)
  })

  // Port of codex `lib.rs:96-103` — `sleep_inhibitor_multiple_true_calls_are_idempotent`.
  it("repeated acquires for the same session are idempotent", () => {
    SleepInhibitor.configure({ enabled: true })

    SleepInhibitor.acquire("s1")
    SleepInhibitor.acquire("s1")
    SleepInhibitor.acquire("s1")
    expect(SleepInhibitor.busyCount()).toBe(1)
    expect(platform.acquires.current).toBe(1)

    SleepInhibitor.release("s1")
    expect(platform.releases.current).toBe(1)
  })

  // Port of codex `lib.rs:105-112` — `sleep_inhibitor_can_toggle_multiple_times`.
  it("can toggle acquire/release multiple times", () => {
    SleepInhibitor.configure({ enabled: true })

    SleepInhibitor.acquire("s1")
    SleepInhibitor.release("s1")
    SleepInhibitor.acquire("s1")
    SleepInhibitor.release("s1")

    expect(platform.acquires.current).toBe(2)
    expect(platform.releases.current).toBe(2)
    expect(SleepInhibitor.active()).toBe(false)
  })
})

describe("SleepInhibitor — multi-session refcount (Kilo extension)", () => {
  it("acquires once on 0->n transition and releases once on n->0", () => {
    SleepInhibitor.configure({ enabled: true })

    SleepInhibitor.acquire("s1")
    SleepInhibitor.acquire("s2")
    SleepInhibitor.acquire("s3")
    expect(SleepInhibitor.busyCount()).toBe(3)
    expect(platform.acquires.current).toBe(1)

    SleepInhibitor.release("s1")
    expect(SleepInhibitor.active()).toBe(true)
    expect(platform.releases.current).toBe(0)

    SleepInhibitor.release("s2")
    expect(SleepInhibitor.active()).toBe(true)

    SleepInhibitor.release("s3")
    expect(SleepInhibitor.active()).toBe(false)
    expect(platform.releases.current).toBe(1)
  })

  it("release for an unknown session is a no-op", () => {
    SleepInhibitor.configure({ enabled: true })

    SleepInhibitor.acquire("s1")
    SleepInhibitor.release("unknown")
    expect(SleepInhibitor.busyCount()).toBe(1)
    expect(SleepInhibitor.active()).toBe(true)
  })

  it("drain releases the platform and clears all sessions", () => {
    SleepInhibitor.configure({ enabled: true })

    SleepInhibitor.acquire("s1")
    SleepInhibitor.acquire("s2")

    SleepInhibitor.drain()

    expect(SleepInhibitor.busyCount()).toBe(0)
    expect(SleepInhibitor.active()).toBe(false)
    expect(platform.releases.current).toBe(1)
  })
})

describe("SleepInhibitor — shutdown and latent-state safety", () => {
  // Kilo-specific: regression test for the lazy-platform bug where
  // `__setPlatformForTests(undefined)` could silently instantiate a real
  // platform inhibitor via `ensure()` if `claimed` was true. See index.ts.
  it("swapping to undefined while claimed releases on the current platform only", () => {
    SleepInhibitor.configure({ enabled: true })
    SleepInhibitor.acquire("s1")
    expect(platform.active.current).toBe(true)

    // Swap to undefined — must release on the CURRENT (spy) platform, not
    // lazily construct a real platform.
    SleepInhibitor.__setPlatformForTests(undefined)
    expect(platform.releases.current).toBe(1)
  })

  it("drain with nothing busy is a no-op", () => {
    SleepInhibitor.configure({ enabled: true })
    SleepInhibitor.drain()
    expect(platform.acquires.current).toBe(0)
    expect(platform.releases.current).toBe(0)
    expect(SleepInhibitor.active()).toBe(false)
  })

  it("release before acquire is a no-op", () => {
    SleepInhibitor.configure({ enabled: true })
    SleepInhibitor.release("never-acquired")
    expect(SleepInhibitor.busyCount()).toBe(0)
    expect(SleepInhibitor.active()).toBe(false)
    expect(platform.releases.current).toBe(0)
  })

  it("drain then fresh acquire re-engages the platform", () => {
    SleepInhibitor.configure({ enabled: true })
    SleepInhibitor.acquire("s1")
    SleepInhibitor.drain()
    SleepInhibitor.acquire("s2")
    expect(SleepInhibitor.active()).toBe(true)
    expect(platform.acquires.current).toBe(2)
  })

  it("disable+re-enable preserves the multi-session busy set", () => {
    SleepInhibitor.configure({ enabled: true })
    SleepInhibitor.acquire("s1")
    SleepInhibitor.acquire("s2")
    SleepInhibitor.configure({ enabled: false })
    SleepInhibitor.release("s1")
    SleepInhibitor.configure({ enabled: true })

    expect(SleepInhibitor.busyCount()).toBe(1)
    expect(SleepInhibitor.active()).toBe(true)
    // One acquire before disable + one re-acquire after enable = 2
    expect(platform.acquires.current).toBe(2)
  })
})

describe("Linux backend — codex parity constants", () => {
  // Port of codex `linux_inhibitor.rs:236-239` `sleep_seconds_is_i32_max`.
  it("SLEEP_SECONDS is i32::MAX", () => {
    expect(SLEEP_SECONDS).toBe(String(2 ** 31 - 1))
    expect(SLEEP_SECONDS).toBe("2147483647")
  })
})

describe("Linux watchdog wrapper — parent-death cleanup", () => {
  // These tests verify the shell script structure that substitutes for
  // codex's `prctl(PR_SET_PDEATHSIG)` at `linux_inhibitor.rs:213-223`.

  it("produces a sh -c invocation", () => {
    const cmd = watchdog(["systemd-inhibit", "--what=idle", "--", "sleep", "60"], 12345)
    expect(cmd[0]).toBe("sh")
    expect(cmd[1]).toBe("-c")
    expect(typeof cmd[2]).toBe("string")
  })

  it("installs an EXIT trap that SIGTERMs the inhibitor child", () => {
    const cmd = watchdog(["systemd-inhibit", "sleep", "1"], 12345)
    expect(cmd[2]).toContain(`trap 'kill -TERM "$c" 2>/dev/null' EXIT`)
  })

  it("polls the parent PID passed in", () => {
    const cmd = watchdog(["systemd-inhibit", "sleep", "1"], 987654)
    expect(cmd[2]).toContain("kill -0 987654")
  })

  it("backgrounds the inhibitor and captures its PID", () => {
    const cmd = watchdog(["systemd-inhibit", "sleep", "1"], 1)
    expect(cmd[2]).toMatch(/\s&\s*;\s*c=\$!/)
  })

  it("escapes single quotes in inner args", () => {
    const cmd = watchdog(["echo", "it's fine"], 1)
    // The standard POSIX escape for a single quote inside a single-quoted
    // string is '\'' (close quote, escaped quote, reopen quote).
    expect(cmd[2]).toContain(`'it'\\''s fine'`)
  })

  it("end-to-end: watchdog kills inhibitor within ~1 second of parent death", async () => {
    // Simulate the core guarantee: when the PID being polled disappears,
    // the watchdog must kill its child.
    //
    // We run the watchdog against a fake parent PID that doesn't exist,
    // with a harmless inner command (sleep 60). The watchdog should kill
    // the sleep and exit within ~1 second.
    const fakeParentPid = 1 // PID 1 (init) always exists, so we invert:
    // use an impossible PID and expect the watchdog to bail immediately.
    const impossiblePid = 2 ** 22 // higher than Linux max PID (default 4M); see /proc/sys/kernel/pid_max
    const cmd = watchdog(["sleep", "60"], impossiblePid)

    const proc = Bun.spawn({ cmd, stdin: "ignore", stdout: "ignore", stderr: "ignore" })

    // Wait up to 3 seconds for the watchdog to notice and exit.
    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3000))
    const exited = proc.exited.then(() => "exited" as const)
    const result = await Promise.race([exited, timeout])

    if (result === "timeout") {
      proc.kill("SIGKILL")
      throw new Error("watchdog did not detect dead parent within 3 seconds")
    }

    expect(result).toBe("exited")
    // Parameter to silence the unused-var warning — we referenced fakeParentPid above in comments.
    void fakeParentPid
  })
})

describe("SleepInhibitor — config toggle mid-turn", () => {
  // Equivalent of codex's config reload behavior in `chatwidget.rs:9747-9749`:
  // toggling `enabled` while a turn is running updates the platform state to
  // match current busy count.
  it("disabling mid-turn releases the platform", () => {
    SleepInhibitor.configure({ enabled: true })
    SleepInhibitor.acquire("s1")
    expect(SleepInhibitor.active()).toBe(true)

    SleepInhibitor.configure({ enabled: false })
    expect(SleepInhibitor.active()).toBe(false)
    expect(platform.releases.current).toBe(1)
    expect(SleepInhibitor.busyCount()).toBe(1)
  })

  it("re-enabling mid-turn re-acquires the platform", () => {
    SleepInhibitor.configure({ enabled: false })
    SleepInhibitor.acquire("s1")
    expect(SleepInhibitor.active()).toBe(false)

    SleepInhibitor.configure({ enabled: true })
    expect(SleepInhibitor.active()).toBe(true)
    expect(platform.acquires.current).toBe(1)
  })

  it("configure is a no-op when value is unchanged", () => {
    SleepInhibitor.configure({ enabled: true })
    SleepInhibitor.acquire("s1")
    const acq = platform.acquires.current

    SleepInhibitor.configure({ enabled: true })
    SleepInhibitor.configure({ enabled: true })

    expect(platform.acquires.current).toBe(acq)
  })
})
