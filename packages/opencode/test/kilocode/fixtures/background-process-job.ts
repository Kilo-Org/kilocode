import { spyOn } from "bun:test"
import { BackgroundProcessRunner } from "@/kilocode/background-process/runner"
import { BackgroundProcessWindows } from "@/kilocode/background-process/windows"
import { Process } from "@/util/process"
import { spawn } from "child_process"
import { once } from "node:events"
import { dlopen } from "bun:ffi"
import path from "path"

const dir = process.argv.at(2)!
const mode = process.argv.at(3)!
const made = await BackgroundProcessWindows.job()
if (!made.job) throw new Error(made.reason)
const job = made.job
const notes: string[] = []
const state = { broken: false, settled: false, walks: 0, queries: 0, kills: 0 }
const output = spyOn(process.stderr, "write").mockImplementation((chunk) => {
  notes.push(String(chunk))
  return true
})
const walk = spyOn(Process, "text").mockImplementation(async () => {
  state.walks++
  throw new Error("unexpected process walk")
})
const until = async (check: () => boolean | Promise<boolean>) => {
  const end = Date.now() + 12_000
  while (Date.now() < end) {
    if (await check()) return
    await Bun.sleep(25)
  }
  throw new Error("live job condition timed out")
}
const timeout = setTimeout(() => {
  job.kill()
  process.exit(1)
}, 35_000)
const control = path.join(dir, "command.stop")
const ready = path.join(dir, "members.json")
const release = path.join(dir, "release")
const middle = `const child = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore", windowsHide: true }); child.unref(); require("fs").writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ middle: process.pid, grand: child.pid })); const timer = setInterval(() => { if (!require("fs").existsSync(${JSON.stringify(release)})) return; clearInterval(timer); process.exit(0) }, 20)`
const source = `const child = require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(middle)}], { detached: true, stdio: "ignore", windowsHide: true }); child.unref(); const timer = setInterval(() => { if (!require("fs").existsSync(${JSON.stringify(release)})) return; clearInterval(timer); process.exit(17) }, 20)`
const leader = spawn(process.execPath, ["-e", mode === "detached" ? source : "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  windowsHide: true,
})
const done = once(leader, "exit").then(([code]) => Number(code))
const wrapper = {
  members() {
    state.queries++
    if (state.broken) throw new Error("injected job query failure")
    return job.members()
  },
  kill() {
    state.kills++
    if (state.broken) throw new Error("injected job kill failure")
    job.kill()
  },
}
const input = { token: "live", shell: process.execPath, args: [], cwd: dir, log: "unused", control }
const guard = (file: string, done: Promise<number>) =>
  BackgroundProcessRunner.contained({ ...input, control: file }, wrapper, done).then(
    (code) => {
      state.settled = true
      return { code }
    },
    (err: unknown) => {
      state.settled = true
      return { error: String(err) }
    },
  )
try {
  if (mode === "detached") {
    await until(() => Bun.file(ready).exists())
    const owned: { middle: number; grand: number } = await Bun.file(ready).json()
    const pending = guard(control, done)
    await Bun.sleep(250) // Exercise two normal polling ticks while the leader is alive.
    const active = state.queries
    await Bun.write(release, "exit")
    await done
    await until(() => !job.members().includes(owned.middle) && !job.members().includes(leader.pid!))
    state.broken = true
    await until(() => notes.some((note) => note.includes("job query failed")) || state.settled)
    const guarded = !state.settled && job.members().includes(owned.grand)
    const began = Date.now()
    await Bun.write(control, "stop")
    await until(async () => state.settled || !(await Bun.file(control).exists()))
    const unsafe = !state.settled && job.members().includes(owned.grand)
    const elapsed = Date.now() - began
    state.broken = false
    await until(() => notes.some((note) => note.includes("job query recovered")) || state.settled)
    await Bun.write(control, "stop")
    const result = await pending
    console.log(JSON.stringify({ ...result, state, notes, active, guarded, unsafe, elapsed, after: job.members() }))
  }
  if (mode === "files") {
    // Bun.file().exists() returns false for denied, invalid and too-long paths on Windows, so only a path Bun rejects makes the check throw
    const checked = guard(control + "\0", done)
    await until(() => notes.some((note) => note.includes("check stop file")) || state.settled)
    leader.kill()
    const check = await Promise.race([
      checked,
      Bun.sleep(2_000).then(() => ({ error: "completion blocked by stop check" })),
    ])
    state.settled = false
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true })
    const ended = once(child, "exit").then(([code]) => Number(code))
    await Bun.write(control, "stop")
    const lib = dlopen("kernel32.dll", {
      CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "u64"], returns: "u64" },
      CloseHandle: { args: ["u64"], returns: "i32" },
    })
    // GENERIC_READ with no sharing, so rm fails with EBUSY while this handle is open
    const handle = lib.symbols.CreateFileW(Buffer.from(control + "\0", "utf16le"), 0x80000000, 0, null, 3, 0, 0n)
    if (handle === 0xffffffffffffffffn) throw new Error("could not lock stop file")
    try {
      const removed = guard(control, ended)
      await until(() => notes.some((note) => note.includes("remove stop file")) || state.settled)
      const remove = await Promise.race([
        removed,
        Bun.sleep(2_000).then(() => ({ error: "completion blocked by stop removal" })),
      ])
      console.log(
        JSON.stringify({
          check,
          remove,
          state,
          notes,
          checks: notes.filter((note) => note.includes("check stop file")).length,
          after: job.members(),
        }),
      )
    } finally {
      lib.symbols.CloseHandle(handle)
      lib.close()
    }
  }
} finally {
  state.broken = false
  job.kill()
  await until(() => job.members().length === 0)
  clearTimeout(timeout)
  output.mockRestore()
  walk.mockRestore()
}
