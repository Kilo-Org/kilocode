import { KiloPtySelfCommand } from "@/kilocode/pty/self-command"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { isRecord } from "@/util/record"
import { mkdir, open, rm } from "fs/promises"
import { spawn } from "child_process"
import path from "path"

export namespace BackgroundProcessRunner {
  const MARKER = "__background-process-runner"
  const MODE = 0o600
  const MAX = 1024 * 1024
  const KEEP = 200 * 1024

  export type Input = {
    token: string
    shell: string
    args: string[]
    cwd: string
    log: string
    control: string
  }

  function encode(input: Input) {
    return Buffer.from(JSON.stringify(input)).toString("base64url")
  }

  function decode(input: string): Input {
    const value: unknown = JSON.parse(Buffer.from(input, "base64url").toString("utf8"))
    if (
      !isRecord(value) ||
      typeof value.token !== "string" ||
      typeof value.shell !== "string" ||
      typeof value.cwd !== "string" ||
      typeof value.log !== "string" ||
      typeof value.control !== "string" ||
      !Array.isArray(value.args)
    ) {
      throw new Error("Invalid background process runner input")
    }
    return {
      token: value.token,
      shell: value.shell,
      args: value.args.filter((item): item is string => typeof item === "string"),
      cwd: value.cwd,
      log: value.log,
      control: value.control,
    }
  }

  export function command(input: Input) {
    const self = KiloPtySelfCommand.command()
    const source = path.basename(self.command).toLowerCase().includes("bun")
    const script = self.args.find((item) => /\.(ts|js|mjs|cjs)$/.test(item))
    const args =
      !source || path.basename(script ?? "") === "index.ts"
        ? self.args
        : [path.resolve(import.meta.dirname, "../../index.ts")]
    return [self.command, ...args, MARKER, input.token, encode(input)]
  }

  async function writer(input: Input) {
    let file = await open(input.log, "a", MODE)
    let size = (await file.stat()).size
    let queue = Promise.resolve()
    const append = (chunk: Buffer) => {
      queue = queue.then(async () => {
        if (size + chunk.length <= MAX) {
          await file.write(chunk)
          size += chunk.length
        } else {
          await file.close()
          const source = Bun.file(input.log)
          const old = size
            ? Buffer.from(await source.slice(Math.max(0, size - KEEP), size).arrayBuffer())
            : Buffer.alloc(0)
          const next = Buffer.concat([old, chunk])
          const tail = next.subarray(Math.max(0, next.length - KEEP))
          await Filesystem.write(input.log, tail, MODE)
          file = await open(input.log, "a", MODE)
          size = tail.length
        }
        if (!process.stdout.destroyed) process.stdout.write(chunk)
      })
    }
    return {
      append,
      async close() {
        await queue
        await file.close()
      },
    }
  }

  async function descendants(root: number, seen: Map<number, string>, active: boolean) {
    const query =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress"
    const out = await Process.text(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", query], {
      nothrow: true,
      abort: AbortSignal.timeout(2_000),
      timeout: 2_000,
    })
    if (out.code !== 0 || !out.text.trim()) return seen
    const value: unknown = JSON.parse(out.text)
    const items = Array.isArray(value) ? value : [value]
    const rows = items.flatMap((item) => {
      if (
        !isRecord(item) ||
        typeof item.ProcessId !== "number" ||
        typeof item.ParentProcessId !== "number" ||
        typeof item.CreationDate !== "string"
      )
        return []
      return [{ pid: item.ProcessId, parent: item.ParentProcessId, birth: item.CreationDate }]
    })
    const live = new Map(rows.map((item) => [item.pid, item.birth]))
    const children = new Map<number, Array<{ pid: number; birth: string }>>()
    for (const row of rows) {
      children.set(row.parent, [...(children.get(row.parent) ?? []), { pid: row.pid, birth: row.birth }])
    }
    const result = new Map(Array.from(seen).filter(([pid, birth]) => live.get(pid) === birth))
    const stack = [...(active ? [root] : []), ...result.keys()]
    while (stack.length > 0) {
      const pid = stack.pop()
      if (!pid) continue
      for (const child of children.get(pid) ?? []) {
        if (result.has(child.pid)) continue
        result.set(child.pid, child.birth)
        stack.push(child.pid)
      }
    }
    return result
  }

  // Grace window after the leader exits during which we keep walking from its
  // pid. A detached descendant spawned just before the leader died may not yet
  // be visible in Win32_Process, and its ParentProcessId still points at the
  // (now dead) leader, so seeding the walk from the leader's pid for a short
  // window lets us capture it before concluding the tree is empty.
  const GRACE = 1_000

  async function windows(input: Input, child: ReturnType<typeof spawn>, done: Promise<number>) {
    const pid = child.pid
    if (!pid) throw new Error("Background process runner child did not provide a pid")
    let code: number | undefined
    let exited: number | undefined
    let failure: unknown
    let seen = new Map<number, string>()
    void done.then(
      (value) => {
        code = value
        exited = Date.now()
      },
      (err) => {
        failure = err
      },
    )
    while (true) {
      if (failure) throw failure
      const active = code === undefined || (exited !== undefined && Date.now() - exited < GRACE)
      seen = await descendants(pid, seen, active)
      if (await Bun.file(input.control).exists()) {
        await Promise.all(
          [pid, ...seen.keys()].map((item) =>
            Process.run(["taskkill", "/pid", String(item), "/f", "/t"], { nothrow: true }),
          ),
        )
        await rm(input.control, { force: true })
        const end = Date.now() + 5_000
        while (Date.now() < end) {
          seen = await descendants(pid, seen, false)
          if (code !== undefined && seen.size === 0) return code
          await Bun.sleep(100)
        }
        throw new Error("Background process runner could not terminate its Windows process tree")
      }
      if (code !== undefined && !active && seen.size === 0) return code
      await Bun.sleep(100)
    }
  }

  async function run(input: Input) {
    process.stdout.on("error", () => process.stdout.destroy())
    await mkdir(path.dirname(input.log), { recursive: true, mode: 0o700 })
    await Promise.all([Filesystem.write(input.log, "", MODE), rm(input.control, { force: true })])
    const output = await writer(input)
    const child = spawn(input.shell, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    child.stdout?.on("data", output.append)
    child.stderr?.on("data", output.append)
    const done = new Promise<number>((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
    })
    try {
      if (process.platform === "win32") return await windows(input, child, done)
      return await done
    } finally {
      await output.close()
    }
  }

  export async function maybe(argv = process.argv) {
    const index = argv.indexOf(MARKER)
    if (index < 0) return false
    const token = argv[index + 1]
    const value = argv[index + 2]
    if (!token || !value) throw new Error("Missing background process runner input")
    const input = decode(value)
    if (input.token !== token) throw new Error("Background process runner token mismatch")
    process.env.KILO_BACKGROUND_PROCESS_TOKEN = token
    process.exitCode = await run(input)
    return true
  }
}
