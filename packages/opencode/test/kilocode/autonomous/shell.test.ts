import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { AutonomousShell } from "@/kilocode/autonomous/shell"

describe("AutonomousShell.exec", () => {
  test("captures output and exit code", async () => {
    const r = await Effect.runPromise(AutonomousShell.sh("echo out; echo err >&2; exit 4", { cwd: process.cwd() }))
    expect(r.code).toBe(4)
    expect(r.stdout.trim()).toBe("out")
    expect(r.stderr.trim()).toBe("err")
    expect(r.timedOut).toBe(false)
  })

  test("timeout kills the whole pipeline, not just the shell", async () => {
    const start = Date.now()
    const r = await Effect.runPromise(AutonomousShell.sh("sleep 30 | cat", { cwd: process.cwd(), timeout: 300 }))
    expect(r.timedOut).toBe(true)
    expect(Date.now() - start).toBeLessThan(AutonomousShell.KILL_GRACE_MS + 2_000)
  })

  test("fiber interruption kills the child", async () => {
    const marker = `/tmp/kilo-shell-${process.pid}-${Date.now()}`
    const fiber = Effect.runFork(AutonomousShell.sh(`sleep 30; touch ${marker}`, { cwd: process.cwd() }))
    await new Promise((r) => setTimeout(r, 200))
    await Effect.runPromise(Fiber.interrupt(fiber))
    await new Promise((r) => setTimeout(r, 300))
    expect(await Bun.file(marker).exists()).toBe(false)
  })
})
