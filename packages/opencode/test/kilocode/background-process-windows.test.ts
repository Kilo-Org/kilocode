import { describe, expect, test } from "bun:test"
import { BackgroundProcessWindows } from "@/kilocode/background-process/windows"
import { Shell } from "@opencode-ai/core/shell"
import { isRecord } from "@/util/record"
import { spawn } from "child_process"
import { once } from "node:events"
import path from "path"
import { tmpdir } from "../fixture/fixture"

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(check: () => boolean, message: string, timeout = 5_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (check()) return
    await Bun.sleep(50)
  }
  throw new Error(message)
}

// Runs `leader` inside a fresh job in its own process (joining a job cannot be undone), waits for
// the leader to exit, then reports the members left behind and kills them.
async function contained(dir: string, leader: { file: string; args: string[] }) {
  const source = path.resolve(import.meta.dirname, "../../src/kilocode/background-process/windows.ts")
  const script = path.join(dir, "job.ts")
  await Bun.write(
    script,
    `import { BackgroundProcessWindows } from ${JSON.stringify(source)}
import { spawn } from "child_process"
import { once } from "node:events"
const made = await BackgroundProcessWindows.job()
if (!made.job) throw new Error(made.reason)
const job = made.job
const leader = spawn(${JSON.stringify(leader.file)}, ${JSON.stringify(leader.args)}, { stdio: "ignore", windowsHide: true })
await once(leader, "exit")
const before = job.members()
const end = Date.now() + 5_000
while (job.members().length > 0 && Date.now() < end) {
  job.kill()
  await Bun.sleep(50)
}
console.log(JSON.stringify({ leader: leader.pid, before, after: job.members() }))
`,
  )
  const run = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe", windowsHide: true })
  const [stdout, stderr, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ])
  expect(stderr).toBe("")
  expect(code).toBe(0)
  const value: unknown = JSON.parse(stdout.trim())
  const pids = (list: unknown) =>
    Array.isArray(list) ? list.filter((item): item is number => typeof item === "number") : undefined
  const before = isRecord(value) ? pids(value.before) : undefined
  const after = isRecord(value) ? pids(value.after) : undefined
  if (!isRecord(value) || typeof value.leader !== "number" || !before || !after) {
    throw new Error(`unexpected job report: ${stdout}`)
  }
  return { leader: value.leader, before, after }
}

describe.skipIf(process.platform !== "win32")("BackgroundProcessWindows", () => {
  test("reads the command line of a live process and reports it once it exited", async () => {
    const mark = `bgp-mark-${process.pid}-${Date.now()}`
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", mark], {
      stdio: "ignore",
      windowsHide: true,
    })
    const pid = child.pid
    if (!pid) throw new Error("child did not start")
    const exited = once(child, "exit")
    try {
      const found = await BackgroundProcessWindows.command(pid)
      expect(found.live).toBe(true)
      expect(found.live ? found.line : "").toContain(mark)
    } finally {
      child.kill()
      await exited
    }
    expect(await BackgroundProcessWindows.command(pid)).toEqual({ live: false })
  })

  test("keeps a detached descendant in the job and kills only members", async () => {
    await using tmp = await tmpdir()
    const pidfile = path.join(tmp.path, "detached.pid")
    const leader = `const child = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore", windowsHide: true })
child.unref()
require("fs").writeFileSync(${JSON.stringify(pidfile)}, String(child.pid))`
    const outside = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    })
    const outsideExit = once(outside, "exit")
    try {
      const result = await contained(tmp.path, { file: process.execPath, args: ["-e", leader] })
      const detached = Number(await Bun.file(pidfile).text())
      expect(result.before).toContain(detached)
      expect(result.before).not.toContain(result.leader)
      expect(result.after).toEqual([])
      await until(() => !alive(detached), "detached member was not terminated")
      expect(alive(outside.pid ?? 0)).toBe(true)
    } finally {
      outside.kill()
      await outsideExit
    }
  }, 30_000)

  // Cygwin programs such as Git Bash ask for CREATE_BREAKAWAY_FROM_JOB whenever their job allows
  // it. The job must not allow it, or everything a Git Bash command starts escapes tracking.
  test("keeps what a Git Bash command started in the job", async () => {
    const bash = Shell.gitbash()
    if (!bash) return
    await using tmp = await tmpdir()
    const pidfile = path.join(tmp.path, "sleep.pid").replaceAll("\\", "/")
    const result = await contained(tmp.path, {
      file: bash,
      args: ["-c", `sleep 60 & cat /proc/$!/winpid > "${pidfile}"; sleep 1`],
    })
    const sleep = Number((await Bun.file(pidfile.replaceAll("/", "\\")).text()).trim())
    expect(sleep).toBeGreaterThan(0)
    expect(result.before).toContain(sleep)
    expect(result.after).toEqual([])
    await until(() => !alive(sleep), "sleep started by Git Bash was not terminated")
  }, 30_000)
})
