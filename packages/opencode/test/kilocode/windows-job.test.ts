import { expect, test } from "bun:test"
import { WindowsJob } from "@/kilocode/background-process/windows-job"
import { spawn } from "child_process"
import { once } from "events"

async function until(check: () => boolean, timeout = 5_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (check()) return
    await Bun.sleep(50)
  }
  throw new Error("Windows Job Object did not release the terminated process")
}

test.skipIf(process.platform !== "win32")("tracks and terminates an assigned process", async () => {
  const job = WindowsJob.create()
  expect(job).toBeDefined()
  if (!job) return
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  })
  if (!child.pid) throw new Error("Test process did not provide a pid")
  try {
    job.assign(child.pid)
    expect(job.members()).toContain(child.pid)
    job.terminate()
    await once(child, "exit")
    await until(() => job.members().length === 0)
  } finally {
    job.close()
    if (child.exitCode === null) child.kill()
  }
})
