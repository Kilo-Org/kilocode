import { describe, expect, test } from "bun:test"
import { KiloPtyTermination } from "../../src/kilocode/pty/termination"

function fake(pid = 123) {
  const calls: Array<string | undefined> = []
  const proc: KiloPtyTermination.Process = {
    pid,
    onExit: () => ({ dispose() {} }),
    kill: (signal) => calls.push(signal),
  }
  return { proc, calls }
}

function runtime(
  platform: NodeJS.Platform,
  input: {
    taskkill?: boolean
    taskkillLeavesAlive?: boolean
    signal?: "throw"
    tree?: Array<{ pid: number; parent: number }>
  } = {},
) {
  const tasks: Array<{
    file: string
    args: string[]
    opts: { stdio: "ignore"; windowsHide: true; timeout: number }
  }> = []
  const signals: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = []
  const sleeps: number[] = []
  let alive = true
  const value: KiloPtyTermination.Runtime = {
    platform,
    taskkill: async (file, args, opts) => {
      tasks.push({ file, args, opts })
      const result = input.taskkill ?? true
      if (result && !input.taskkillLeavesAlive) alive = false
      return result
    },
    tree: async () => input.tree ?? [],
    alive: () => alive,
    signal: (pid, signal) => {
      signals.push({ pid, signal })
      if (signal === "SIGKILL") alive = false
      if (input.signal === "throw") throw new Error("process group unavailable")
    },
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  }
  return { value, tasks, signals, sleeps, dead: () => (alive = false) }
}

describe("pty process-tree termination", () => {
  test("uses hidden taskkill for Windows process trees", async () => {
    const item = fake(42)
    const input = runtime("win32")

    await KiloPtyTermination.terminate(item.proc, input.value)

    expect(input.tasks).toEqual([
      {
        file: "taskkill",
        args: ["/pid", "42", "/f", "/t"],
        opts: { stdio: "ignore", windowsHide: true, timeout: 5_000 },
      },
    ])
    expect(input.signals).toEqual([])
    expect(item.calls).toEqual([])
    expect(input.sleeps).toEqual([200])
  })

  test("falls back when Windows taskkill reports success but the PTY remains alive", async () => {
    const input = runtime("win32", { taskkillLeavesAlive: true })
    const item = fake(42)
    item.proc.kill = (signal) => {
      item.calls.push(signal)
      input.dead()
    }

    await KiloPtyTermination.terminate(item.proc, input.value)

    expect(item.calls).toEqual([undefined])
    expect(input.sleeps).toEqual([200])
  })

  test("signals POSIX process groups before escalating", async () => {
    const item = fake(42)
    const input = runtime("linux")

    await KiloPtyTermination.terminate(item.proc, input.value)

    expect(input.signals).toEqual([
      { pid: -42, signal: "SIGTERM" },
      { pid: 42, signal: "SIGTERM" },
      { pid: -42, signal: "SIGKILL" },
      { pid: 42, signal: "SIGKILL" },
    ])
    expect(item.calls).toEqual([])
    expect(input.sleeps).toEqual([200, 200])
  })

  test("falls back to direct PTY signals when a process group is unavailable", async () => {
    const item = fake(42)
    const input = runtime("darwin", { signal: "throw" })

    await KiloPtyTermination.terminate(item.proc, input.value)

    expect(item.calls).toEqual(["SIGTERM", "SIGKILL"])
  })

  test("signals descendants that run in separate process groups", async () => {
    const item = fake(42)
    const input = runtime("linux", {
      tree: [
        { pid: 43, parent: 42 },
        { pid: 44, parent: 43 },
      ],
    })

    await KiloPtyTermination.terminate(item.proc, input.value)

    expect(input.signals).toContainEqual({ pid: -44, signal: "SIGTERM" })
    expect(input.signals).toContainEqual({ pid: 44, signal: "SIGKILL" })
    expect(input.signals).toContainEqual({ pid: -43, signal: "SIGTERM" })
    expect(input.signals).toContainEqual({ pid: 43, signal: "SIGKILL" })
  })
})
