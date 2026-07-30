import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
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

        const outside = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-test-cli-cwd-"))
        const serve = Bun.spawn([process.execPath, "run", entry, "serve", "--hostname", "127.0.0.1", "--port", "0"], {
          cwd: outside,
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
        const stderr = new Response(serve.stderr).text()
        const output = await (async () => {
          const reader = serve.stdout.getReader()
          const decoder = new TextDecoder()
          let text = ""
          while (!text.includes("kilo server listening on")) {
            const chunk = await reader.read()
            if (chunk.done) break
            text += decoder.decode(chunk.value, { stream: true })
          }
          reader.releaseLock()
          return text
        })()
        if (serve.exitCode === null) serve.kill()
        const [code, err] = await Promise.all([serve.exited, stderr])
        expect(output, `stdout:\n${output}\nstderr:\n${err}`).toContain("kilo server listening on")
        expect(code, `stdout:\n${output}\nstderr:\n${err}`).not.toBe(1)
      } finally {
        if (!process.env[TestCli.ENV]) await fs.rm(dir, { recursive: true, force: true })
      }
    },
    30_000,
  )
})
