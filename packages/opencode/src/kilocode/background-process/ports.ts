import { Process } from "@/util/process"
import fs from "fs/promises"
import path from "path"

const SCAN_MS = 1_000

function sorted(items: Iterable<number>) {
  return Array.from(items).toSorted((a, b) => a - b)
}

function parse(addr: string) {
  const raw = addr.split(":").at(-1)
  if (!raw) return
  const port = Number.parseInt(raw, 16)
  if (!Number.isFinite(port) || port <= 0) return
  return port
}

async function ppid(pid: number) {
  const text = await fs.readFile(`/proc/${pid}/stat`, "utf8")
  const match = text.match(/^\d+ \(.+\) \S+ (\d+)/)
  if (!match) return
  return Number(match[1])
}

async function tree(root: number) {
  const names = await fs.readdir("/proc")
  const rows = await Promise.all(
    names
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        const pid = Number(name)
        const parent = await ppid(pid).catch(() => undefined)
        if (!parent) return
        return { pid, parent }
      }),
  )
  const children = new Map<number, number[]>()
  for (const row of rows) {
    if (!row) continue
    children.set(row.parent, [...(children.get(row.parent) ?? []), row.pid])
  }
  const result = new Set([root])
  const stack = [root]
  while (stack.length > 0) {
    const pid = stack.pop()
    if (!pid) continue
    for (const child of children.get(pid) ?? []) {
      if (result.has(child)) continue
      result.add(child)
      stack.push(child)
    }
  }
  return result
}

async function sockets(pids: Set<number>) {
  const all = await Promise.all(
    Array.from(pids).map(async (pid) => {
      const dir = `/proc/${pid}/fd`
      const files = await fs.readdir(dir).catch(() => [])
      const links = await Promise.allSettled(files.map((file) => fs.readlink(path.join(dir, file))))
      return links.flatMap((item) => {
        if (item.status !== "fulfilled") return []
        const match = item.value.match(/^socket:\[(\d+)\]$/)
        return match ? [match[1]] : []
      })
    }),
  )
  return new Set(all.flat())
}

async function file(name: string, inodes: Set<string>) {
  const text = await fs.readFile(name, "utf8").catch(() => "")
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const parts = line.trim().split(/\s+/)
      if (parts[3] !== "0A") return []
      if (!inodes.has(parts[9])) return []
      const port = parse(parts[1])
      return port ? [port] : []
    })
}

async function linux(root: number) {
  const pids = await tree(root)
  const found = await sockets(pids)
  if (found.size === 0) return []
  const ports = await Promise.all([file("/proc/net/tcp", found), file("/proc/net/tcp6", found)])
  return sorted(new Set(ports.flat()))
}

async function ps(root: number) {
  const rows = await lines(["ps", "-axo", "pid=,ppid="])
  const children = new Map<number, number[]>()
  for (const row of rows) {
    const [pid, parent] = row.trim().split(/\s+/).map(Number)
    if (!pid || !parent) continue
    children.set(parent, [...(children.get(parent) ?? []), pid])
  }
  const result = new Set([root])
  const stack = [root]
  while (stack.length > 0) {
    const pid = stack.pop()
    if (!pid) continue
    for (const child of children.get(pid) ?? []) {
      if (result.has(child)) continue
      result.add(child)
      stack.push(child)
    }
  }
  return result
}

async function lsof(root: number) {
  const pids = await ps(root).catch(() => new Set([root]))
  const rows = await lines(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", Array.from(pids).join(",")])
  return sorted(
    new Set(
      rows.flatMap((row) => {
        const match = row.match(/:(\d+)\s+\(LISTEN\)$/)
        return match ? [Number(match[1])] : []
      }),
    ),
  )
}

async function lines(cmd: string[]) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), SCAN_MS)
  timer.unref?.()
  try {
    return await Process.lines(cmd, { nothrow: true, abort: ctrl.signal, timeout: 500 })
  } finally {
    clearTimeout(timer)
  }
}

export async function list(root: number) {
  if (process.platform === "linux") {
    const ports = await linux(root).catch(() => [])
    if (ports.length > 0) return ports
  }
  if (process.platform === "win32") return []
  return lsof(root).catch(() => [])
}
