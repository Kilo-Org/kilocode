import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { remove } from "./cleanup"

const root = path.resolve(import.meta.dir, "../..")

describe("test runner cleanup", () => {
  test("removes the temp environment after an abrupt child exit", async () => {
    await using tmp = await tmpdir()
    const name = `runner-abrupt-${process.pid}-${Date.now()}.test.ts`
    const file = path.join(import.meta.dir, name)
    const marker = path.join(tmp.path, "pid")
    const state = { pid: 0 }
    const src = [
      'const marker = process.env.KILO_TEST_RUNNER_PID_FILE',
      'if (!marker) throw new Error("KILO_TEST_RUNNER_PID_FILE is required")',
      'await Bun.write(marker, String(process.pid))',
      'process.exit(1)',
      '',
    ].join("\n")

    await fs.writeFile(file, src)

    try {
      const proc = Bun.spawn(
        [
          "bun",
          "run",
          "script/test-runner.ts",
          "--concurrency",
          "1",
          "--retries",
          "-1",
          `kilocode/${name}`,
        ],
        {
          cwd: root,
          env: { ...process.env, KILO_TEST_RUNNER_PID_FILE: marker },
          stdout: "pipe",
          stderr: "pipe",
          windowsHide: true,
        },
      )
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      if (!(await Bun.file(marker).exists())) {
        throw new Error(`child did not record its pid\n${stderr || stdout}`)
      }

      state.pid = Number(await fs.readFile(marker, "utf8"))
      expect(code).not.toBe(0)
      expect(await Bun.file(path.join(os.tmpdir(), `opencode-test-data-${state.pid}`)).exists()).toBe(false)
    } finally {
      await fs.rm(file, { force: true })
      if (state.pid) await remove(path.join(os.tmpdir(), `opencode-test-data-${state.pid}`))
    }
  })
})
