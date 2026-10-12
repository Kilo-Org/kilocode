import { describe, expect, spyOn, test } from "bun:test"
import { BackgroundProcessRunner } from "@/kilocode/background-process/runner"
import { Process } from "@/util/process"
import * as child from "child_process"
import { once } from "node:events"
import path from "path"
import { tmpdir } from "../fixture/fixture"

const start = Date.parse("2026-10-03T20:00:00.000Z")

function birth(offset: number) {
  return `/Date(${start + offset})/`
}

describe("BackgroundProcessRunner.walk", () => {
  test("adopts the leader's children and their descendants", () => {
    const rows = [
      { pid: 100, parent: 4, birth: birth(0) },
      { pid: 200, parent: 100, birth: birth(10) },
      { pid: 300, parent: 200, birth: birth(20) },
    ]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start })
    expect([...result.keys()].toSorted((a, b) => a - b)).toEqual([200, 300])
  })

  test("does not adopt a process created before its claimed parent", () => {
    // 900 was started by an earlier process that also had PID 200; that process is gone
    // and Windows reused the PID for the leader's child.
    const rows = [
      { pid: 100, parent: 4, birth: birth(0) },
      { pid: 200, parent: 100, birth: birth(10) },
      { pid: 900, parent: 200, birth: birth(-3_600_000) },
    ]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start })
    expect(result.has(200)).toBe(true)
    expect(result.has(900)).toBe(false)
  })

  test("does not adopt a process created before the leader", () => {
    const rows = [{ pid: 900, parent: 100, birth: birth(-60_000) }]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start })
    expect(result.size).toBe(0)
  })

  test("keeps a detached child whose leader already exited", () => {
    const rows = [{ pid: 200, parent: 100, birth: birth(30) }]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start, end: start + 40 })
    expect([...result.keys()]).toEqual([200])
  })

  test("ignores children of an unrelated process that reused the leader pid", () => {
    const rows = [
      { pid: 100, parent: 4, birth: birth(5_000) },
      { pid: 600, parent: 100, birth: birth(5_010) },
    ]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start, end: start + 40 })
    expect(result.size).toBe(0)
  })

  test("drops tracked processes whose pid now belongs to another process", () => {
    const rows = [{ pid: 200, parent: 4, birth: birth(9_000) }]
    const result = BackgroundProcessRunner.walk(rows, new Map([[200, birth(10)]]))
    expect(result.size).toBe(0)
  })

  test("reads ISO creation dates as well", () => {
    const rows = [
      { pid: 200, parent: 100, birth: new Date(start + 10).toISOString() },
      { pid: 900, parent: 200, birth: new Date(start - 60_000).toISOString() },
    ]
    const result = BackgroundProcessRunner.walk(rows, new Map(), { pid: 100, start })
    expect([...result.keys()]).toEqual([200])
  })
})

async function lifecycle(reuse: boolean) {
  await using tmp = await tmpdir()
  const input = {
    token: "cutoff",
    shell: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    cwd: tmp.path,
    log: path.join(tmp.path, "command.log"),
    control: path.join(tmp.path, "command.stop"),
  }
  const state: { pid: number; reads: number; rows: BackgroundProcessRunner.Row[] } = {
    pid: 0,
    reads: 0,
    rows: [],
  }
  const targets: number[] = []
  const code = process.exitCode ?? 0
  const token = process.env.KILO_BACKGROUND_PROCESS_TOKEN
  const spawned = spyOn(child, "spawn")
  const read = spyOn(Process, "text").mockImplementation(async () => {
    state.reads++
    if (state.reads === 1) {
      const proc = spawned.mock.results.at(0)?.value
      if (!(proc instanceof child.ChildProcess) || !proc.pid) throw new Error("runner did not spawn the leader")
      state.pid = proc.pid
      const birth = Date.now()
      const exited = once(proc, "exit")
      proc.kill()
      await exited // The runner's earlier exit listener settles before this enumeration returns.
      state.rows = [
        { pid: state.pid, parent: 4, birth: `/Date(${Date.now() + 10_000})/` },
        { pid: 900_001, parent: state.pid, birth: `/Date(${birth})/` },
        ...(reuse ? [{ pid: 900_002, parent: state.pid, birth: `/Date(${Date.now() + 10_010})/` }] : []),
      ]
    }
    // Later polls cannot reconnect the unrelated child to the leader. If the first
    // enumeration adopted it, its unchanged identity still keeps it in `seen`.
    if (state.reads === 2) state.rows = state.rows.map((row) => (row.pid === 900_002 ? { ...row, parent: 4 } : row))
    if (state.reads === 3) await Bun.write(input.control, "stop")
    return {
      code: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      text: JSON.stringify(
        state.rows.map((row) => ({ ProcessId: row.pid, ParentProcessId: row.parent, CreationDate: row.birth })),
      ),
    }
  })
  const kill = spyOn(Process, "run").mockImplementation(async (args) => {
    if (args.at(0) !== "taskkill") throw new Error("unexpected runner command")
    const pid = Number(args.at(2))
    targets.push(pid)
    state.rows = state.rows.filter((row) => row.pid !== pid)
    return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  })
  try {
    expect(await BackgroundProcessRunner.maybe(BackgroundProcessRunner.command(input))).toBe(true)
    return { pid: state.pid, targets, reads: state.reads }
  } finally {
    const proc = spawned.mock.results.at(0)?.value
    if (proc instanceof child.ChildProcess && proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, "exit")
      proc.kill()
      await exited
    }
    read.mockRestore()
    kill.mockRestore()
    spawned.mockRestore()
    process.exitCode = code
    if (token === undefined) delete process.env.KILO_BACKGROUND_PROCESS_TOKEN
    if (token !== undefined) process.env.KILO_BACKGROUND_PROCESS_TOKEN = token
  }
}

test.skipIf(process.platform !== "win32")(
  "leader exit during enumeration rejects reused-pid children on later polls and stop",
  async () => {
    const result = await lifecycle(true)
    expect(result.reads).toBeGreaterThanOrEqual(4)
    expect(result.targets).not.toContain(900_002)
    expect(result.targets).toContain(900_001)
  },
  20_000,
)

test.skipIf(process.platform !== "win32")(
  "a stop never targets the exited leader's reused pid",
  async () => {
    const result = await lifecycle(false)
    expect(result.targets).not.toContain(result.pid)
    expect(result.targets).toContain(900_001)
  },
  20_000,
)

test.skipIf(process.platform !== "win32")(
  "stop refreshes birth-checked descendants and never asks taskkill to traverse parent pids",
  async () => {
    await using tmp = await tmpdir()
    const input = {
      token: "stop-walk",
      shell: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: tmp.path,
      log: path.join(tmp.path, "command.log"),
      control: path.join(tmp.path, "command.stop"),
    }
    const state: { pid: number; reads: number; birth: number; rows: BackgroundProcessRunner.Row[] } = {
      pid: 0,
      reads: 0,
      birth: 0,
      rows: [],
    }
    const calls: string[][] = []
    const code = process.exitCode ?? 0
    const token = process.env.KILO_BACKGROUND_PROCESS_TOKEN
    const spawned = spyOn(child, "spawn")
    const read = spyOn(Process, "text").mockImplementation(async () => {
      state.reads++
      if (state.reads === 1) {
        const proc = spawned.mock.results.at(0)?.value
        if (!(proc instanceof child.ChildProcess) || !proc.pid) throw new Error("runner did not spawn the leader")
        state.pid = proc.pid
        state.birth = Date.now()
        state.rows = [
          { pid: state.pid, parent: 4, birth: `/Date(${state.birth})/` },
          { pid: 900_001, parent: state.pid, birth: `/Date(${state.birth})/` },
          { pid: 900_002, parent: 900_001, birth: `/Date(${state.birth - 60_000})/` },
        ]
        await Bun.write(input.control, "stop")
      }
      if (state.reads === 2) state.rows.push({ pid: 900_003, parent: 900_001, birth: `/Date(${state.birth})/` })
      if (state.reads === 3) state.rows.push({ pid: 900_004, parent: state.pid, birth: `/Date(${state.birth})/` })
      return {
        code: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        text: JSON.stringify(
          state.rows.map((row) => ({ ProcessId: row.pid, ParentProcessId: row.parent, CreationDate: row.birth })),
        ),
      }
    })
    const kill = spyOn(Process, "run").mockImplementation(async (args) => {
      if (args.at(0) !== "taskkill") throw new Error("unexpected runner command")
      calls.push(args)
      const pid = Number(args.at(2))
      state.rows = state.rows.filter((row) => row.pid !== pid)
      if (pid === state.pid) {
        const proc = spawned.mock.results.at(0)?.value
        if (!(proc instanceof child.ChildProcess)) throw new Error("leader missing")
        const exited = once(proc, "exit")
        proc.kill()
        await exited
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    })
    try {
      expect(await BackgroundProcessRunner.maybe(BackgroundProcessRunner.command(input))).toBe(true)
      expect(calls.every((args) => !args.includes("/t"))).toBe(true)
      const pids = calls.map((args) => Number(args.at(2)))
      expect(pids).toContain(state.pid)
      expect(pids).toContain(900_001)
      expect(pids).toContain(900_003)
      expect(pids).toContain(900_004)
      expect(pids).not.toContain(900_002)
      expect(state.reads).toBeGreaterThanOrEqual(4)
    } finally {
      const proc = spawned.mock.results.at(0)?.value
      if (proc instanceof child.ChildProcess && proc.exitCode === null && proc.signalCode === null) {
        const exited = once(proc, "exit")
        proc.kill()
        await exited
      }
      read.mockRestore()
      kill.mockRestore()
      spawned.mockRestore()
      process.exitCode = code
      if (token === undefined) delete process.env.KILO_BACKGROUND_PROCESS_TOKEN
      if (token !== undefined) process.env.KILO_BACKGROUND_PROCESS_TOKEN = token
    }
  },
  20_000,
)

for (const failure of ["failed", "malformed", "slow"] as const)
  test.skipIf(process.platform !== "win32")(
    `stop does not kill tracked pids when its fresh process walk is ${failure}`,
    async () => {
      await using tmp = await tmpdir()
      const input = {
        token: "stop-walk-failure",
        shell: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: tmp.path,
        log: path.join(tmp.path, "command.log"),
        control: path.join(tmp.path, "command.stop"),
      }
      const state = { pid: 0, reads: 0, birth: 0, restored: false }
      const calls: Array<{ pid: number; restored: boolean }> = []
      const code = process.exitCode ?? 0
      const token = process.env.KILO_BACKGROUND_PROCESS_TOKEN
      const spawned = spyOn(child, "spawn")
      const read = spyOn(Process, "text").mockImplementation(async (_args, opts) => {
        state.reads++
        if (state.reads === 1) {
          const proc = spawned.mock.results.at(0)?.value
          if (!(proc instanceof child.ChildProcess) || !proc.pid) throw new Error("runner did not spawn the leader")
          state.pid = proc.pid
          state.birth = Date.now()
          await Bun.write(input.control, "stop")
        }
        if (state.reads === 2 && failure === "slow") {
          await Bun.sleep(2_500)
          if ((opts?.timeout ?? 0) < 2_500)
            return { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), text: "" }
        }
        if (state.reads === 2 && failure !== "slow")
          return {
            code: failure === "failed" ? 1 : 0,
            stdout: Buffer.alloc(0),
            stderr: Buffer.alloc(0),
            text: failure === "failed" ? "" : "not JSON",
          }
        state.restored = state.reads > 2 || (failure === "slow" && state.reads === 2)
        const rows = state.restored
          ? [{ ProcessId: state.pid, ParentProcessId: 4, CreationDate: `/Date(${state.birth})/` }]
          : [
              { ProcessId: state.pid, ParentProcessId: 4, CreationDate: `/Date(${state.birth})/` },
              { ProcessId: 900_001, ParentProcessId: state.pid, CreationDate: `/Date(${state.birth})/` },
            ]
        return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), text: JSON.stringify(rows) }
      })
      const kill = spyOn(Process, "run").mockImplementation(async (args) => {
        const pid = Number(args.at(2))
        calls.push({ pid, restored: state.restored })
        if (pid === state.pid) {
          const proc = spawned.mock.results.at(0)?.value
          if (!(proc instanceof child.ChildProcess)) throw new Error("leader missing")
          const exited = once(proc, "exit")
          proc.kill()
          await exited
        }
        return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      })
      try {
        expect(await BackgroundProcessRunner.maybe(BackgroundProcessRunner.command(input))).toBe(true)
        expect(calls.length).toBeGreaterThan(0)
        expect(calls.filter((call) => call.pid !== state.pid).every((call) => call.restored)).toBe(true)
        expect(calls.some((call) => call.pid === 900_001)).toBe(false)
        expect(await Bun.file(input.control).exists()).toBe(false)
      } finally {
        const proc = spawned.mock.results.at(0)?.value
        if (proc instanceof child.ChildProcess && proc.exitCode === null && proc.signalCode === null) {
          const exited = once(proc, "exit")
          proc.kill()
          await exited
        }
        read.mockRestore()
        kill.mockRestore()
        spawned.mockRestore()
        process.exitCode = code
        if (token === undefined) delete process.env.KILO_BACKGROUND_PROCESS_TOKEN
        if (token !== undefined) process.env.KILO_BACKGROUND_PROCESS_TOKEN = token
      }
    },
    20_000,
  )

test.skipIf(process.platform !== "win32")(
  "an unverified stop keeps its control request and runner until a later trustworthy walk",
  async () => {
    await using tmp = await tmpdir()
    const input = {
      token: "stop-unverified",
      shell: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: tmp.path,
      log: path.join(tmp.path, "command.log"),
      control: path.join(tmp.path, "command.stop"),
    }
    let pid = 0
    let birth = 0
    let restore = false
    let reads = 0
    const targets: number[] = []
    const previous = process.exitCode ?? 0
    const token = process.env.KILO_BACKGROUND_PROCESS_TOKEN
    const spawned = spyOn(child, "spawn")
    const read = spyOn(Process, "text").mockImplementation(async () => {
      reads++
      if (reads === 1) {
        const proc = spawned.mock.results.at(0)?.value
        if (!(proc instanceof child.ChildProcess) || !proc.pid) throw new Error("runner did not start")
        pid = proc.pid
        birth = Date.now()
        await Bun.write(input.control, "stop")
        return {
          code: 0,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          text: JSON.stringify([
            { ProcessId: pid, ParentProcessId: 4, CreationDate: `/Date(${birth})/` },
            { ProcessId: 900_001, ParentProcessId: pid, CreationDate: `/Date(${birth})/` },
          ]),
        }
      }
      if (!restore) {
        await Bun.sleep(100)
        return { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), text: "" }
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), text: "[]" }
    })
    const kill = spyOn(Process, "run").mockImplementation(async (args) => {
      const target = Number(args.at(2))
      targets.push(target)
      if (target === pid) {
        const proc = spawned.mock.results.at(0)?.value
        if (!(proc instanceof child.ChildProcess)) throw new Error("leader missing")
        const done = once(proc, "exit")
        proc.kill()
        await done
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    })
    let ended = false
    const run = BackgroundProcessRunner.maybe(BackgroundProcessRunner.command(input)).finally(() => {
      ended = true
    })
    void run.catch(() => {})
    try {
      while (pid === 0) {
        await Bun.sleep(20)
        const proc = spawned.mock.results.at(0)?.value
        if (proc instanceof child.ChildProcess) pid = proc.pid ?? 0
      }
      await Bun.sleep(5_500)
      expect(ended).toBe(false)
      expect(await Bun.file(input.control).exists()).toBe(true)
      expect(targets).not.toContain(900_001)
      restore = true
      expect(await run).toBe(true)
      expect(await Bun.file(input.control).exists()).toBe(false)
    } finally {
      restore = true
      const proc = spawned.mock.results.at(0)?.value
      if (proc instanceof child.ChildProcess && proc.exitCode === null && proc.signalCode === null) {
        const done = once(proc, "exit")
        proc.kill()
        await done
      }
      await run.catch(() => {})
      read.mockRestore()
      kill.mockRestore()
      spawned.mockRestore()
      process.exitCode = previous
      if (token === undefined) delete process.env.KILO_BACKGROUND_PROCESS_TOKEN
      else process.env.KILO_BACKGROUND_PROCESS_TOKEN = token
    }
  },
  20_000,
)
