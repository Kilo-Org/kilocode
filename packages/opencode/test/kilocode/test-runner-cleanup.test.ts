import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { remove } from "./cleanup"

const root = path.resolve(import.meta.dir, "../..")

function env(marker: string) {
  const vars: NodeJS.ProcessEnv = { ...process.env, KILO_TEST_RUNNER_PID_FILE: marker }
  delete vars.KILO_TEST_PROFILE
  delete vars.KILO_TEST_SHARD
  return vars
}

function spawn(name: string, marker: string) {
  return Bun.spawn(
    ["bun", "run", "script/test-runner.ts", "--concurrency", "1", "--retries", "-1", `kilocode/${name}`],
    {
      cwd: root,
      env: env(marker),
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    },
  )
}

async function deadline<T>(promise: Promise<T>, timeout: number) {
  const expired = Symbol("expired")
  const result = await Promise.race([promise, Bun.sleep(timeout).then(() => expired)])
  if (result === expired) throw new Error(`Timed out after ${timeout}ms`)
  return result
}

describe("test runner cleanup", () => {
  test("removes the temp environment after an abrupt child exit", async () => {
    await using tmp = await tmpdir()
    const name = `runner-abrupt-${process.pid}-${Date.now()}.test.ts`
    const file = path.join(import.meta.dir, name)
    const marker = path.join(tmp.path, "pid")
    const state = { pid: 0 }
    const src = [
      "const marker = process.env.KILO_TEST_RUNNER_PID_FILE",
      'if (!marker) throw new Error("KILO_TEST_RUNNER_PID_FILE is required")',
      "await Bun.write(marker, String(process.pid))",
      "process.exit(1)",
      "",
    ].join("\n")

    await fs.writeFile(file, src)
    const proc = spawn(name, marker)
    const stdout = new Response(proc.stdout).text()
    const stderr = new Response(proc.stderr).text()

    try {
      const code = await deadline(proc.exited, 15_000)
      const output = await Promise.all([stdout, stderr])

      if (!(await Bun.file(marker).exists())) {
        throw new Error(`child did not record its pid\n${output[1] || output[0]}`)
      }

      state.pid = Number(await fs.readFile(marker, "utf8"))
      expect(code).not.toBe(0)
      expect(await Bun.file(path.join(os.tmpdir(), `opencode-test-data-${state.pid}`)).exists()).toBe(false)
    } finally {
      if (proc.exitCode === null) proc.kill("SIGKILL")
      await proc.exited
      await fs.rm(file, { force: true })
      if (state.pid) await remove(path.join(os.tmpdir(), `opencode-test-data-${state.pid}`))
    }
  })

  test.skipIf(process.platform === "win32")(
    "removes active temp environments when the runner is terminated",
    async () => {
      await using tmp = await tmpdir()
      const name = `runner-signal-${process.pid}-${Date.now()}.test.ts`
      const file = path.join(import.meta.dir, name)
      const marker = path.join(tmp.path, "pid")
      const state = { pid: 0 }
      const src = [
        "const marker = process.env.KILO_TEST_RUNNER_PID_FILE",
        'if (!marker) throw new Error("KILO_TEST_RUNNER_PID_FILE is required")',
        "await Bun.write(marker, String(process.pid))",
        "const parent = process.ppid",
        "setInterval(() => process.ppid === parent || process.exit(1), 50)",
        "await Bun.sleep(60_000)",
        "",
      ].join("\n")

      await fs.writeFile(file, src)
      const proc = spawn(name, marker)
      const stdout = new Response(proc.stdout).text()
      const stderr = new Response(proc.stderr).text()

      try {
        await deadline(
          (async () => {
            while (!(await Bun.file(marker).exists())) await Bun.sleep(10)
          })(),
          10_000,
        )
        state.pid = Number(await fs.readFile(marker, "utf8"))
        proc.kill("SIGTERM")

        expect(await deadline(proc.exited, 10_000)).toBe(143)
        await Promise.all([stdout, stderr])
        expect(await Bun.file(path.join(os.tmpdir(), `opencode-test-data-${state.pid}`)).exists()).toBe(false)
      } finally {
        if (proc.exitCode === null) proc.kill("SIGKILL")
        await proc.exited
        await fs.rm(file, { force: true })
        if (state.pid) await remove(path.join(os.tmpdir(), `opencode-test-data-${state.pid}`))
      }
    },
    30_000,
  )
})
