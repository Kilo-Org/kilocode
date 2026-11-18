import { describe, expect, test } from "bun:test"
import { cancelChromiumInstall, installChromium } from "../src/browser-settings/install-chromium"

// The spawned process is the test runner itself, so the test does not depend on a real CLI or network.
const command = (code: string) => ({ cmd: process.execPath, args: ["-e", code, "serve"], env: {} })
const env = { ...process.env }
const log = () => {}

describe("chromium install", () => {
  test("a finished install answers with its output and progress", async () => {
    const progress: string[] = []
    const result = await installChromium({
      command: command("console.log('chromium ready')"),
      cwd: process.cwd(),
      env,
      log,
      onProgress: (text) => progress.push(text),
    })
    expect(result.ok).toBe(true)
    expect(result.output).toContain("chromium ready")
    expect(progress.join("")).toContain("chromium ready")
  })

  test("an install that outlives its timeout is killed and reported", async () => {
    const started = Date.now()
    const result = await installChromium({
      command: command("await Bun.sleep(5000)"),
      cwd: process.cwd(),
      env,
      log,
      timeoutMs: 100,
    })
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain("timed out")
    // The promise resolves at the timeout, not when the killed child eventually exits.
    expect(Date.now() - started).toBeLessThan(4000)
  })

  test("only one install runs at a time", async () => {
    const first = installChromium({
      command: command("await Bun.sleep(5000)"),
      cwd: process.cwd(),
      env,
      log,
    })
    const second = await installChromium({
      command: command("console.log('second')"),
      cwd: process.cwd(),
      env,
      log,
    })
    expect(second.busy).toBe(true)
    expect(second.ok).toBe(false)
    cancelChromiumInstall()
    expect((await first).cancelled).toBe(true)
  })

  test("cancelling stops the running install", async () => {
    const running = installChromium({ command: command("await Bun.sleep(5000)"), cwd: process.cwd(), env, log })
    cancelChromiumInstall()
    const result = await running
    expect(result.ok).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(result.output).toContain("cancelled")
  })
})
