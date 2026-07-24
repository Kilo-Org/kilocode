import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { TestCli } from "../../script/kilocode/test-cli"

const root = path.resolve(import.meta.dir, "../..")

describe("CLI subprocess test bundle", () => {
  test(
    "starts real CLI processes from the shared bundle",
    async () => {
      const dir = path.join(root, ".artifacts", `test-cli-regression-${process.pid}-${Date.now()}`)
      try {
        const entry = await (async () => {
          if (process.env[TestCli.ENV]) return process.env[TestCli.ENV]
          const script = [
            'import { TestCli } from "./script/kilocode/test-cli"',
            `console.log(await TestCli.build(process.cwd(), ${JSON.stringify(dir)}))`,
          ].join(";")
          const proc = Bun.spawn([process.execPath, "-e", script], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
            windowsHide: true,
          })
          const [code, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
          ])
          if (code !== 0) throw new Error(`Test CLI build failed:\n${stderr}`)
          return stdout.trim()
        })()
        const runs = Array.from({ length: 4 }, () => {
          const proc = Bun.spawn([process.execPath, "run", entry, "--help"], {
            cwd: root,
            env: {
              ...process.env,
              KILO_DB: ":memory:",
              KILO_CONFIG_CONTENT: "{}",
              KILO_AUTH_CONTENT: "{}",
              KILO_DISABLE_MODELS_FETCH: "1",
              KILO_DISABLE_PROJECT_CONFIG: "1",
              KILO_PURE: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
            windowsHide: true,
          })
          return Promise.all([proc.exited, new Response(proc.stderr).text()])
        })
        const results = await Promise.all(runs)
        expect(results.map(([code]) => code)).toEqual([0, 0, 0, 0])
        for (const [, stderr] of results) expect(stderr).toContain("Commands:")
      } finally {
        if (!process.env[TestCli.ENV]) await fs.rm(dir, { recursive: true, force: true })
      }
    },
    30_000,
  )
})
