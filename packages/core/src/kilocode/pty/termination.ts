import { spawn } from "child_process"
import { readdir, readFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import type { Proc } from "../../pty/pty"
import { Log } from "../../util/log"

const log = Log.create({ service: "pty.termination" })
const GRACE_MS = 200
const SPAWN_TIMEOUT_MS = 5_000

export type Process = Pick<Proc, "pid" | "onExit" | "kill">

export type Runtime = {
  readonly platform: NodeJS.Platform
  readonly taskkill: (
    file: string,
    args: string[],
    opts: { stdio: "ignore"; windowsHide: true; timeout: number },
  ) => Promise<boolean>
  readonly tree: () => Promise<Array<{ pid: number; parent: number }>>
  readonly alive: (pid: number) => boolean
  readonly signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => void
  readonly sleep: (ms: number) => Promise<void>
}

const runtime: Runtime = {
  platform: process.platform,
  taskkill,
  tree,
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
  signal: (pid, signal) => process.kill(pid, signal),
  sleep,
}

function direct(proc: Process, signal?: "SIGTERM" | "SIGKILL") {
  try {
    proc.kill(signal)
  } catch (err) {
    log.warn("failed to kill PTY directly", { err, pid: proc.pid, signal })
  }
}

function descendants(root: number, rows: Array<{ pid: number; parent: number }>) {
  const children = new Map<number, number[]>()
  for (const row of rows) {
    const list = children.get(row.parent) ?? []
    list.push(row.pid)
    children.set(row.parent, list)
  }
  const seen = new Set<number>()
  const collect = (pid: number): number[] => {
    const result: number[] = []
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      result.push(...collect(child), child)
    }
    return result
  }
  return collect(root)
}

async function family(root: number, input: Runtime) {
  const rows = await input.tree()
  return [...descendants(root, rows), root]
}

function signal(proc: Process, pids: number[], value: "SIGTERM" | "SIGKILL", input: Runtime) {
  for (const pid of pids) {
    let sent = false
    for (const target of [-pid, pid]) {
      try {
        input.signal(target, value)
        sent = true
      } catch (err) {
        log.debug("failed to signal PTY process", { err, pid: target, signal: value })
      }
    }
    if (pid === proc.pid && !sent) direct(proc, value)
  }
}

async function tree(file: string = "ps", args: string[] = ["-axo", "pid=,ppid="]) {
  if (process.platform === "linux") {
    try {
      const rows = await procTree()
      if (rows.length > 0) return rows
    } catch (err) {
      log.debug("failed to read Linux process tree", { err })
    }
  }

  return await new Promise<Array<{ pid: number; parent: number }>>((resolve, reject) => {
    try {
      const child = spawn(file, args, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: "SIGKILL",
      })
      const chunks: Buffer[] = []
      child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk))
      child.once("error", reject)
      child.once("close", (code) => {
        if (code !== 0) return reject(new Error(`process tree command exited with ${code}`))
        const rows = Buffer.concat(chunks)
          .toString("utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => line.trim().split(/\s+/).map(Number))
          .filter(([pid, parent]) => Number.isSafeInteger(pid) && Number.isSafeInteger(parent))
          .map(([pid, parent]) => ({ pid: pid!, parent: parent! }))
        resolve(rows)
      })
    } catch (error) {
      reject(error)
    }
  })
}

async function procTree() {
  const entries = await readdir("/proc", { withFileTypes: true })
  const rows = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map(async (entry) => {
        const stat = await readFile(`/proc/${entry.name}/stat`, "utf8").catch(() => undefined)
        if (!stat) return
        const match = stat.match(/^\d+ \(.*\) [A-Z] (\d+)/)
        if (!match) return
        return { pid: Number(entry.name), parent: Number(match[1]) }
      }),
  )
  return rows.filter((row): row is { pid: number; parent: number } => row !== undefined)
}

async function taskkill(file: string, args: string[], opts: { stdio: "ignore"; windowsHide: true; timeout: number }) {
  return await new Promise<boolean>((resolve) => {
    try {
      const child = spawn(file, args, opts)
      child.once("exit", (code) => resolve(code === 0))
      child.once("error", (err) => {
        log.warn("taskkill failed", { err })
        resolve(false)
      })
    } catch (err) {
      log.warn("failed to start taskkill", { err })
      resolve(false)
    }
  })
}

export async function terminate(proc: Process, input: Runtime = runtime): Promise<void> {
  const state = { exited: false }
  const listener = proc.onExit(() => {
    state.exited = true
  })
  try {
    if (!proc.pid) {
      direct(proc)
      if (!state.exited) await input.sleep(GRACE_MS)
      await verify(proc, state.exited, input)
      return
    }

    if (input.platform === "win32") {
      const killed = await input.taskkill("taskkill", ["/pid", String(proc.pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: SPAWN_TIMEOUT_MS,
      })
      if ((!killed || input.alive(proc.pid)) && !state.exited) direct(proc)
      if (!state.exited) await input.sleep(GRACE_MS)
      if (!state.exited && input.alive(proc.pid)) throw new Error(`PTY process tree is still alive: ${proc.pid}`)
      return
    }

    const initial = await family(proc.pid, input)
    signal(proc, initial, "SIGTERM", input)
    await input.sleep(GRACE_MS)
    const remaining = new Set(initial.filter(input.alive))
    if (input.alive(proc.pid)) for (const pid of await family(proc.pid, input)) remaining.add(pid)
    if (remaining.size > 0) {
      signal(proc, [...remaining], "SIGKILL", input)
      await input.sleep(GRACE_MS)
    }
    await verify(proc, state.exited, input)
  } finally {
    listener.dispose()
  }
}

async function verify(proc: Process, exited: boolean, input: Runtime) {
  if (!proc.pid) return
  const live = (await family(proc.pid, input)).filter((pid) => input.alive(pid) && !(pid === proc.pid && exited))
  if (!exited && input.alive(proc.pid) && !live.includes(proc.pid)) live.push(proc.pid)
  if (live.length > 0) throw new Error(`PTY process tree is still alive: ${live.join(", ")}`)
}

export * as KiloPtyTermination from "./termination"
