import { afterEach, describe, expect, test } from "bun:test"
import { startParentWatchdog } from "../../src/kilocode/parent-watchdog"

describe("startParentWatchdog", () => {
  afterEach(() => {
    delete process.env["KILO_PARENT_PID"]
  })

  test("is a no-op when KILO_PARENT_PID is unset", () => {
    delete process.env["KILO_PARENT_PID"]
    let called = false
    const stop = startParentWatchdog(() => {
      called = true
    })
    stop()
    expect(called).toBe(false)
  })

  test("is a no-op for an invalid KILO_PARENT_PID", () => {
    process.env["KILO_PARENT_PID"] = "0"
    let called = false
    const stop = startParentWatchdog(() => {
      called = true
    })
    stop()
    expect(called).toBe(false)
  })

  test("fires onOrphan once the watched parent process is gone", async () => {
    // Spawn a real process, kill it, and wait for it to be reaped so its PID is dead.
    const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(30000)"], { stdout: "ignore", stderr: "ignore" })
    const pid = child.pid
    child.kill("SIGKILL")
    await child.exited
    process.env["KILO_PARENT_PID"] = String(pid)

    let stop = () => {}
    const orphaned = new Promise<void>((resolve) => {
      stop = startParentWatchdog(resolve, 10)
    })
    try {
      await Promise.race([
        orphaned,
        new Promise((_, reject) => setTimeout(() => reject(new Error("watchdog did not fire")), 5000)),
      ])
    } finally {
      stop()
    }
  })
})
