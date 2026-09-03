// Unit tests for readPipedStdin — the bounded piped-stdin read used by
// `kilo run`'s loadInput(). The read is injected so the tests never touch the
// real process stdin; the never-resolving read reproduces the held-open pipe
// that hung the CLI (see script/kilocode/repro-run-stdin-hang.sh).
import { describe, expect, test } from "bun:test"
import { readPipedStdin } from "@/cli/cmd/run-stdin"

function neverRead(): Promise<string> {
  return new Promise<string>(() => {})
}

describe("readPipedStdin", () => {
  test("bound read returns undefined when the silence timer wins", async () => {
    const start = Date.now()
    const value = await readPipedStdin({ bound: true, timeoutMs: 50, read: neverRead })
    expect(value).toBeUndefined()
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })

  test("bound read returns piped text when it arrives before the timer fires", async () => {
    const value = await readPipedStdin({ bound: true, timeoutMs: 1000, read: async () => "piped notes" })
    expect(value).toBe("piped notes")
  })

  test("bound read passes through a read that resolves to undefined", async () => {
    const value = await readPipedStdin({ bound: true, timeoutMs: 1000, read: async () => undefined })
    expect(value).toBeUndefined()
  })

  test("unbound read keeps waiting for EOF when the read never resolves", async () => {
    const pending = readPipedStdin({ bound: false, read: neverRead })
    const winner = await Promise.race([pending.then(() => "read"), Bun.sleep(100).then(() => "timer")])
    expect(winner).toBe("timer")
  })

  test("unbound read returns piped text on EOF", async () => {
    const value = await readPipedStdin({ bound: false, read: async () => "piped notes" })
    expect(value).toBe("piped notes")
  })

  test("a rejecting read propagates to the caller in both modes", async () => {
    const reject = (): Promise<string> => Promise.reject(new Error("stdin read failed"))
    await expect(readPipedStdin({ bound: true, timeoutMs: 1000, read: reject })).rejects.toThrow("stdin read failed")
    await expect(readPipedStdin({ bound: false, read: reject })).rejects.toThrow("stdin read failed")
  })
})
