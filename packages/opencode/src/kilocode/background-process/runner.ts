import { KiloPtySelfCommand } from "@/kilocode/pty/self-command"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { isRecord } from "@/util/record"
import { mkdir, open, rm } from "fs/promises"
import { spawn } from "child_process"
import path from "path"
import { BackgroundProcessWindows } from "./windows"

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
    const cwd = source && self.cwd ? ["--cwd", self.cwd] : []
    return [self.command, ...cwd, ...args, MARKER, input.token, encode(input)]
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

  export type Row = { pid: number; parent: number; birth: string }
  export type Root = { pid: number; start: number; end?: number }

  // Win32_Process CreationDate as epoch ms. Windows PowerShell 5.1 emits "/Date(ms)/".
  function time(birth: string) {
    const ms = /Date\((\d+)\)/.exec(birth)?.[1]
    return ms ? Number(ms) : Date.parse(birth)
  }

  // Windows keeps a dead parent's PID in ParentProcessId and reuses PIDs, so a row whose
  // parent matches a tracked PID is not necessarily its child. A real child is created after
  // its parent, and a child of the leader is created between spawn and exit. Anything else
  // belongs to an earlier or later process with the same PID and must not be adopted, or the
  // runner keeps polling for it and the stop path kills it.
  export function walk(rows: Row[], seen: Map<number, string>, root?: Root) {
    const live = new Map(rows.map((item) => [item.pid, item.birth]))
    const children = new Map<number, Row[]>()
    for (const row of rows) {
      children.set(row.parent, [...(children.get(row.parent) ?? []), row])
    }
    const result = new Map(Array.from(seen).filter(([pid, birth]) => live.get(pid) === birth))
    const stack: Root[] = [
      ...(root ? [root] : []),
      ...Array.from(result, ([pid, birth]) => ({ pid, start: time(birth) })),
    ]
    while (stack.length > 0) {
      const parent = stack.pop()
      if (!parent) continue
      for (const child of children.get(parent.pid) ?? []) {
        if (result.has(child.pid)) continue
        const birth = time(child.birth)
        if (!(birth >= parent.start)) continue
        if (parent.end !== undefined && birth > parent.end) continue
        result.set(child.pid, child.birth)
        stack.push({ pid: child.pid, start: birth })
      }
    }
    return result
  }

  async function descendants(seen: Map<number, string>, root?: Root) {
    const query =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress"
    const out = await Process.text(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", query], {
      nothrow: true,
      abort: AbortSignal.timeout(2_000),
      timeout: 2_000,
    })
    if (out.code !== 0 || !out.text.trim()) return { seen, ok: false }
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
    return { seen: walk(rows, seen, root), ok: true }
  }

  // Goes to stderr, which serve appends to the process output, so the agent and the user see it.
  function note(message: string) {
    if (!process.stderr.destroyed) process.stderr.write(`background process runner: ${message}\n`)
  }

  function control(file: string) {
    const noted = new Set<string>()
    const failed = (action: string, err: unknown) => {
      if (noted.has(action)) return
      noted.add(action)
      note(`could not ${action} stop file, retrying: ${String(err)}`)
    }
    return {
      exists: () =>
        Promise.resolve()
          .then(() => Bun.file(file).exists())
          .catch((err: unknown) => {
            failed("check", err)
            return undefined
          }),
      clear: () =>
        rm(file, { force: true }).then(
          () => true,
          (err: unknown) => {
            failed("remove", err)
            return false
          },
        ),
    }
  }

  // The job holds the command and every process it started, so the runner only has to wait
  // until the command exited and no other member is left. A stop terminates the members.
  // Once assigned, the job remains the authority even if a native call temporarily fails.
  // A process-table walk cannot recover detached members or safely invent an exit bound.
  export async function contained(input: Input, job: BackgroundProcessWindows.Job, done: Promise<number>) {
    let code: number | undefined
    let failure: unknown
    void done.then(
      (value) => {
        code = value
      },
      (err) => {
        failure = err
      },
    )
    const stop = control(input.control)
    let warned = false
    const faults = new Set<string>()
    const call = <T>(action: string, fn: () => T) => {
      try {
        const value = fn()
        if (faults.delete(action)) note(`job ${action} recovered`)
        return { value }
      } catch (err) {
        if (!faults.has(action)) note(`job ${action} failed, still guarding it: ${String(err)}`)
        faults.add(action)
        return undefined
      }
    }
    const empty = () => call("query", () => job.members())?.value.length === 0
    while (true) {
      if (failure) throw failure
      const requested = await stop.exists()
      if (requested) {
        const end = Date.now() + 5_000
        while (Date.now() < end) {
          if (code !== undefined && empty()) break
          call("kill", () => job.kill())
          await Bun.sleep(50)
        }
        if (code !== undefined && empty()) {
          await stop.clear()
          return code
        }
        // Keep guarding what could not be ended. Serve then reports the stop as failed instead
        // of seeing the runner disappear while the command keeps running.
        const cleared = await stop.clear()
        if (!warned) note("could not end every process of the command, still guarding it")
        warned = !cleared
        continue
      }
      if (code !== undefined && empty()) return code
      await Bun.sleep(100)
    }
  }

  // Grace window after the leader exits during which we keep walking from its
  // pid. A detached descendant spawned just before the leader died may not yet
  // be visible in Win32_Process, and its ParentProcessId still points at the
  // (now dead) leader, so seeding the walk from the leader's pid for a short
  // window lets us capture it before concluding the tree is empty.
  const GRACE = 1_000

  async function windows(input: Input, child: ReturnType<typeof spawn>, done: Promise<number>, start: number) {
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
    const root = () =>
      code === undefined || (exited !== undefined && Date.now() - exited < GRACE)
        ? { pid, start, end: exited }
        : undefined
    while (true) {
      if (failure) throw failure
      const from = root()
      const walked = await descendants(seen, from)
      seen = walked.seen
      if (await Bun.file(input.control).exists()) {
        // Only pids a walk verified: the leader while it is alive, and descendants whose creation
        // time matched. No `/t`, because taskkill would walk parent pids on its own without that
        // check, and a dead leader's pid may already belong to another process. The stop only
        // counts once a walk that actually ran finds nothing left.
        const end = Date.now() + 5_000
        while (Date.now() < end) {
          await Promise.all(
            [...(code === undefined ? [pid] : []), ...seen.keys()].map((item) =>
              Process.run(["taskkill", "/pid", String(item), "/f"], { nothrow: true }),
            ),
          )
          await Bun.sleep(100)
          const next = await descendants(seen, root())
          seen = next.seen
          if (code !== undefined && next.ok && seen.size === 0) {
            await rm(input.control, { force: true })
            return code
          }
        }
        await rm(input.control, { force: true })
        note("could not confirm that every process of the command ended, still guarding it")
        continue
      }
      // Same rule as for a stop: an empty set only means the command is done if the walk ran.
      if (code !== undefined && !from && walked.ok && seen.size === 0) return code
      await Bun.sleep(100)
    }
  }

  async function run(input: Input) {
    process.stdout.on("error", () => process.stdout.destroy())
    process.stderr.on("error", () => process.stderr.destroy())
    await mkdir(path.dirname(input.log), { recursive: true, mode: 0o700 })
    await Promise.all([Filesystem.write(input.log, "", MODE), rm(input.control, { force: true })])
    const output = await writer(input)
    // Join the job before starting the command so that it and every descendant are members
    // from the moment they exist. Without a job, fall back to walking the process table.
    const job = process.platform === "win32" ? await BackgroundProcessWindows.job() : undefined
    if (job?.reason) note(`${job.reason}, polling the process table instead`)
    const start = Date.now()
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
      if (job?.job) return await contained(input, job.job, done)
      if (process.platform === "win32") return await windows(input, child, done, start)
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
